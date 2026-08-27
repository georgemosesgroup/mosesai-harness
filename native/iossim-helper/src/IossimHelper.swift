/*
 * Copyright (c) 2026, iossim-helper contributors. BSD 3-Clause (see the
 * workspace LICENSE).
 *
 * The iossim-helper native helper: a background executable with no user
 * interface that speaks the framed request/response protocol over its standard
 * streams (native/iossim-helper/README.md owns the protocol). It exists to
 * serve what the public `xcrun simctl` surface cannot — today exactly one
 * operation, `describe`, the device availability tree read through
 * FBSimulatorControl's accessibility reader.
 *
 * stdout carries protocol frames and nothing else; every diagnostic goes to
 * stderr. No environment variable influences behavior — test injection is the
 * provider's explicit helper-path configuration, never ambient state.
 */

import FBControlCore
import FBSimulatorControl
import Foundation

// MARK: - Protocol constants

/// The one supported protocol version; the hello frame announces it and the
/// provider refuses anything else.
let PROTOCOL_VERSION = 1

/// Upper bound of one frame's JSON body in bytes. A deep availability tree is
/// measured in megabytes at worst; anything past this bound is a protocol
/// error, not a tree.
let MAX_FRAME_BYTES = 64 << 20

/// Exit status for helper-level fatal failures (bad argv, unwritable stdout).
/// The provider classifies a nonzero exit as a dead helper and supervises.
let HELPER_FAILURE_EXIT: Int32 = 70

// MARK: - Failures

/// One failed request, already named in the seam's failure vocabulary. The
/// provider passes the code through verbatim so every simulator failure keeps
/// its distinct repair path.
struct RequestFailure: Error {
  let code: String
  let message: String
}

/// Stream-framing corruption or an op the protocol does not define. Distinct
/// from a request failure: it concerns the pipe, not the substrate.
struct ProtocolBroken: Error {
  let message: String
}

// MARK: - Frame IO

/// Incremental length-prefixed frame reader over one file handle. Blocking
/// reads run off the cooperative pool on a plain queue; the buffer is guarded
/// by a lock, which also makes the reader safe to lift across isolation.
final class FrameReader: @unchecked Sendable {
  private let handle: FileHandle
  private let lock = NSLock()
  private var buffer = Data()

  init(fileHandle: FileHandle) {
    self.handle = fileHandle
  }

  /// Blocking read of exactly `count` bytes, or `nil` at clean EOF. An IO
  /// error throws — it is not EOF, and the caller must not treat it as one.
  private func readExact(_ count: Int) throws -> Data? {
    while buffer.count < count {
      guard let chunk = try handle.read(upToCount: count - buffer.count) else {
        return nil
      }
      if chunk.isEmpty {
        return nil
      }
      buffer.append(chunk)
    }
    let head = buffer.prefix(count)
    buffer.removeFirst(count)
    return Data(head)
  }

  /// One framed JSON body, or `nil` at clean EOF. A frame past
  /// `MAX_FRAME_BYTES` poisons the stream framing and reports as protocol
  /// broken.
  func readFrame() throws -> Data? {
    lock.lock()
    defer { lock.unlock() }
    guard let lengthBytes = try readExact(4) else {
      return nil
    }
    let length = lengthBytes.reduce(0) { ($0 << 8) | Int($1) }
    guard length > 0, length <= MAX_FRAME_BYTES else {
      throw ProtocolBroken(message: "frame length \(length) is outside the 1...\(MAX_FRAME_BYTES) byte bound")
    }
    return try readExact(length)
  }

  /// `readFrame()` lifted onto a background queue so the blocking read never
  /// occupies a cooperative thread.
  func readFrameAsync() async throws -> Data? {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global().async {
        do {
          continuation.resume(returning: try self.readFrame())
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}

// MARK: - Entry point

@main
struct IossimHelper {
  static func main() async {
    signal(SIGPIPE, SIG_IGN)
    guard CommandLine.arguments.count == 1 else {
      FileHandle.standardError.write(
        Data("iossim-helper: takes no arguments; it is driven through its stdio protocol\n".utf8))
      exit(HELPER_FAILURE_EXIT)
    }
    await HelperLoop().run()
    exit(0)
  }
}

// MARK: - Helper loop

@MainActor
final class HelperLoop {
  private let reader = FrameReader(fileHandle: .standardInput)
  private var control: FBSimulatorControl?

  func run() async {
    // The hello frame is the launch proof: the provider waits for it, so a
    // helper that cannot even announce itself fails the launch loudly.
    guard writeFrame([
      "helper": "iossim-helper",
      "protocol": PROTOCOL_VERSION,
      "ops": ["describe"],
    ]) else {
      exit(HELPER_FAILURE_EXIT)
    }
    while true {
      let body: Data?
      do {
        body = try await reader.readFrameAsync()
      } catch {
        // A bad length or an IO error poisons stream framing — answer once
        // with the reason and stop; the provider supervises the restart.
        writeError(id: 0, code: "SIMULATOR_HELPER_PROTOCOL_BROKEN", message: describe(error))
        return
      }
      guard let body else {
        return // Clean EOF on stdin: the provider is done; drain and exit.
      }
      guard let request = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
        let id = request["id"] as? Int
      else {
        // Unparsable frame: stream framing is intact (the length prefix
        // parsed), so answer with a protocol error and keep serving.
        writeError(id: 0, code: "SIMULATOR_HELPER_PROTOCOL_BROKEN", message: "request is not a JSON object with an integer id")
        continue
      }
      let op = request["op"] as? String
      let params = request["params"] as? [String: Any] ?? [:]
      switch op {
      case "describe":
        do {
          let result = try await describe(params)
          writeFrame(["id": id, "ok": true, "result": result])
        } catch {
          writeFailure(id: id, error: error)
        }
      default:
        writeError(id: id, code: "SIMULATOR_HELPER_PROTOCOL_BROKEN", message: "unknown op \(op.map { "\"\($0)\"" } ?? "<missing>")")
      }
    }
  }

  // MARK: - Operations

  /// `describe`: the availability tree of one device. Target resolution mirrors
  /// the seam's explicit rule — an omitted reference requires exactly ONE
  /// booted device, and each mismatch names its own failure.
  private func describe(_ params: [String: Any]) async throws -> [String: Any] {
    let simulator = try resolveSimulator(requestedUdid: params["simulatorId"] as? String)
    let ui = try simulator.uiAutomation(backend: .accessibility)
    let options = FBAccessibilityRequestOptions(format: .complete, enableLogging: false)
    let response = try await ui.describe(.frontmost, options: options)

    var result: [String: Any] = [
      "simulatorId": simulator.udid,
      "truncated": response.truncated,
    ]
    if let root = rootJSON(response.elements) {
      result["root"] = root
    }
    if let screen = response.screen {
      result["screen"] = ["width": screen.width, "height": screen.height]
    }
    return result
  }

  /// The framework's frozen wire form for the read's root element: a
  /// frontmost read yields one application tree (or nothing on an empty
  /// read), so the protocol carries a single root object or null.
  private func rootJSON(_ payload: FBAccessibilityElementPayload) -> Any? {
    switch payload {
    case let .tree(elements):
      return elements.first?.legacyFoundationObject
    case let .single(element):
      return element.legacyFoundationObject
    case .empty:
      return nil
    }
  }

  // MARK: - Simulator resolution

  private func resolveControl() throws -> FBSimulatorControl {
    if let control {
      return control
    }
    do {
      let built = try FBSimulatorControl.withConfiguration(
        FBSimulatorControlConfiguration(deviceSetPath: nil, logger: nil))
      control = built
      return built
    } catch {
      throw RequestFailure(
        code: "SIMULATOR_HELPER_UNAVAILABLE",
        message: "FBSimulatorControl could not bind the CoreSimulator device set: \(describe(error))")
    }
  }

  private func resolveSimulator(requestedUdid: String?) throws -> FBSimulator {
    let set = try resolveControl().set
    if let requestedUdid {
      guard let simulator = set.simulator(withUDID: requestedUdid) else {
        throw RequestFailure(
          code: "SIMULATOR_DEVICE_NOT_FOUND",
          message: "no available simulator matches \"\(requestedUdid)\" (\(set.allSimulators.count) visible)")
      }
      guard simulator.state == .booted else {
        throw RequestFailure(
          code: "SIMULATOR_DEVICE_NOT_BOOTED",
          message: "simulator \"\(requestedUdid)\" is \(simulator.stateString), not booted; boot it and retry")
      }
      return simulator
    }
    let booted = set.allSimulators.filter { $0.state == .booted }
    switch booted.count {
    case 0:
      throw RequestFailure(
        code: "SIMULATOR_DEVICE_NOT_BOOTED",
        message: "no simulator reference was given and no simulator is booted; boot one and retry")
    case 1:
      guard let only = booted.first else {
        throw RequestFailure(code: "SIMULATOR_HELPER_REQUEST_FAILED", message: "the booted-device listing emptied between guards")
      }
      return only
    default:
      let names = booted.map { "\"\($0.name)\" \($0.udid)" }.joined(separator: ", ")
      throw RequestFailure(
        code: "SIMULATOR_TARGET_AMBIGUOUS",
        message: "\(booted.count) simulators are booted and none was named (\(names)); pass an explicit device id")
    }
  }

  // MARK: - Writing

  private func writeFrame(_ json: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(json),
      let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
    else {
      // A frame the JSON writer refuses is a helper bug, not a request
      // error: the response would be unframed garbage either way.
      FileHandle.standardError.write(Data("iossim-helper: built a non-serializable frame\n".utf8))
      exit(HELPER_FAILURE_EXIT)
    }
    return writeBody(data)
  }

  private func writeError(id: Int, code: String, message: String) {
    writeFrame(["id": id, "ok": false, "error": ["code": code, "message": message]])
  }

  /// A failed operation reports its seam code (resolution failures carry
  /// theirs); anything else reports as a helper request failure carrying the
  /// framework's own diagnostic.
  private func writeFailure(id: Int, error: Error) {
    switch error {
    case let failure as RequestFailure:
      writeError(id: id, code: failure.code, message: failure.message)
    case let broken as ProtocolBroken:
      writeError(id: id, code: "SIMULATOR_HELPER_PROTOCOL_BROKEN", message: broken.message)
    default:
      writeError(id: id, code: "SIMULATOR_HELPER_REQUEST_FAILED", message: describe(error))
    }
  }

  private func describe(_ error: Error) -> String {
    String(describing: error)
  }

  private func writeBody(_ data: Data) -> Bool {
    var length = UInt32(data.count).bigEndian
    let prefix = Data(bytes: &length, count: 4)
    do {
      try FileHandle.standardOutput.write(contentsOf: prefix)
      try FileHandle.standardOutput.write(contentsOf: data)
      return true
    } catch {
      // stdout is the protocol: an unwritable stdout ends the helper.
      FileHandle.standardError.write(Data("iossim-helper: stdout write failed: \(error)\n".utf8))
      exit(HELPER_FAILURE_EXIT)
    }
  }
}
