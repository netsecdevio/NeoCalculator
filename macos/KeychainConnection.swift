import Foundation
import Security
import LocalAuthentication

let keychainService = "io.netsecdev.neocalculator.math"
enum ConnectionFailure: Error {
    case missing, authorization, busy, timeout, storage
    var message: String {
        switch self {
        case .missing: return "Choose Connect to Silas from the app menu and enter a setup code."
        case .authorization: return "Unlock your login Keychain, then choose Unlock saved connection from the silascalc menu and approve the macOS prompt."
        case .busy: return "A Keychain request is still waiting. Complete or cancel its macOS prompt, then retry. The calculator remains available."
        case .timeout: return "Keychain did not respond. Complete or cancel any macOS authorization prompt, unlock your login Keychain, and retry from the silascalc menu. If it remains stuck, restart silascalc."
        case .storage: return "The connection could not be read or saved in Keychain. Unlock your login Keychain and retry from the silascalc menu."
        }
    }
}

// All Security calls stay on this one worker. No HTTP or UI queue waits for them.
// The deadline does not cancel Security.framework: keep the operation occupied
// until it returns, so repeated requests cannot create unbounded blocked workers.
final class KeychainConnection {
    typealias Outcome = Result<String, ConnectionFailure>
    typealias Operation = (_ token: String?, _ interactive: Bool) -> Outcome
    private let lock = NSLock()
    private let worker = DispatchQueue(label: "calculator.keychain")
    private let operation: Operation
    private let deadline: TimeInterval
    private var active = false
    private var activeRead: ReadBatch?
    private var cached: String?
    init(deadline: TimeInterval = 4, operation: @escaping Operation = KeychainConnection.access) {
        self.deadline = deadline; self.operation = operation
    }
    func read(interactive: Bool = false, completion: @escaping (Outcome) -> Void) {
        perform(token: nil, interactive: interactive, completion: completion)
    }
    func save(_ token: String, interactive: Bool = false, completion: @escaping (Outcome) -> Void) {
        perform(token: token, interactive: interactive, completion: completion)
    }
    private func perform(token: String?, interactive: Bool, completion: @escaping (Outcome) -> Void) {
        lock.lock()
        if token == nil, !interactive, let value = cached {
            lock.unlock(); completion(.success(value)); return
        }
        if active {
            // Only ordinary reads share a pending ordinary read. A timed-out
            // batch refuses new joins while its Security call remains occupied.
            if token == nil, !interactive, let batch = activeRead, batch.append(completion) {
                lock.unlock(); return
            }
            lock.unlock(); completion(.failure(.busy)); return
        }
        active = true
        let once = CompletionOnce(completion)
        let batch = token == nil && !interactive ? ReadBatch(once) : nil
        activeRead = batch; lock.unlock()
        let finish: (Outcome) -> Void = { result in
            if let batch = batch { batch.finish(result) } else { once.finish(result) }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + (interactive ? max(deadline, 60) : deadline)) {
            finish(.failure(.timeout))
        }
        worker.async {
            let result = self.operation(token, interactive)
            self.lock.lock()
            if case .success(let value) = result { self.cached = value }
            self.active = false; self.activeRead = nil; self.lock.unlock()
            finish(result)
        }
    }
    static func access(token: String?, interactive: Bool) -> Outcome {
        // Existing installs use the legacy login Keychain. LAContext alone does
        // not suppress legacy ACL prompts, so also scope the legacy UI policy.
        // This changes prompt behavior only; it never deletes an item or its ACL.
        var previous = DarwinBoolean(true)
        guard SecKeychainGetUserInteractionAllowed(&previous) == errSecSuccess,
              SecKeychainSetUserInteractionAllowed(interactive) == errSecSuccess else { return .failure(.storage) }
        defer { SecKeychainSetUserInteractionAllowed(previous.boolValue) }
        let context = LAContext(); context.interactionNotAllowed = !interactive
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService, kSecAttrAccount as String: "device",
            kSecUseAuthenticationContext as String: context]
        var status: OSStatus
        if let token = token {
            let data = Data(token.utf8)
            status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                var item = query; item[kSecValueData as String] = data
                item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                status = SecItemAdd(item as CFDictionary, nil)
            }
            if status == errSecSuccess { return .success(token) }
        } else {
            var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            status = SecItemCopyMatching(read as CFDictionary, &result)
            if status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty { return .success(token) }
        }
        if status == errSecItemNotFound { return .failure(.missing) }
        if [errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled].contains(status) { return .failure(.authorization) }
        return .failure(.storage)
    }
}
private final class CompletionOnce {
    private let lock = NSLock()
    private var callback: ((KeychainConnection.Outcome) -> Void)?
    init(_ callback: @escaping (KeychainConnection.Outcome) -> Void) { self.callback = callback }
    func finish(_ result: KeychainConnection.Outcome) {
        lock.lock(); let action = callback; callback = nil; lock.unlock()
        action?(result)
    }
}

// Each batch owns its deadline and callbacks. Old timers or late worker results
// can only finish their own batch, never a newer operation. Callbacks run unlocked.
private final class ReadBatch {
    private let lock = NSLock()
    private var callbacks: [CompletionOnce]
    private var closed = false
    init(_ first: CompletionOnce) { callbacks = [first] }
    func append(_ callback: @escaping (KeychainConnection.Outcome) -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !closed, callbacks.count < 16 else { return false }
        callbacks.append(CompletionOnce(callback)); return true
    }
    func finish(_ result: KeychainConnection.Outcome) {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        closed = true; let pending = callbacks; callbacks.removeAll(); lock.unlock()
        for callback in pending { callback.finish(result) }
    }
}
