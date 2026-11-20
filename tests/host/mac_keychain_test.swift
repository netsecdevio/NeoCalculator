import Foundation

@main
struct KeychainTests {
    static func main() {
        let release = DispatchSemaphore(value: 0)
        let callback = DispatchSemaphore(value: 0)
        let returned = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var calls = 0, completions = 0
        let store = KeychainConnection(deadline: 0.05) { _, interactive in
            precondition(!interactive)
            lock.lock(); calls += 1; lock.unlock()
            release.wait()
            returned.signal()
            return .success("synthetic-token")
        }
        let http = DispatchQueue(label: "test.http")
        let staticResponse = DispatchSemaphore(value: 0)
        http.async {
            store.read { result in
                guard case .failure(.timeout) = result else { fatalError("Expected bounded timeout") }
                lock.lock(); completions += 1; lock.unlock(); callback.signal()
            }
        }
        http.async { staticResponse.signal() }
        precondition(staticResponse.wait(timeout: .now()+1) == .success, "Credential access blocked the caller queue")
        precondition(callback.wait(timeout: .now()+1) == .success, "No timeout response")
        let busy = DispatchSemaphore(value: 0)
        store.read { result in
            guard case .failure(.busy) = result else { fatalError("Blocked calls must not pile up") }
            busy.signal()
        }
        precondition(busy.wait(timeout: .now()+1) == .success)
        release.signal(); precondition(returned.wait(timeout: .now()+1) == .success)
        Thread.sleep(forTimeInterval: 0.1)
        lock.lock(); precondition(calls == 1 && completions == 1); lock.unlock()
        let cached = DispatchSemaphore(value: 0)
        store.read { result in
            guard case .success("synthetic-token") = result else { fatalError("Successful late read not retained") }
            cached.signal()
        }
        precondition(cached.wait(timeout: .now()+1) == .success)
        var writes = 0
        let writable = KeychainConnection { token, interactive in
            writes += 1
            if !interactive { return .failure(.authorization) }
            precondition(token == "new-synthetic-token")
            return .success(token!)
        }
        let denied = DispatchSemaphore(value: 0)
        writable.save("new-synthetic-token") { result in
            guard case .failure(.authorization) = result else { fatalError("Expected authorization requirement") }
            denied.signal()
        }
        precondition(denied.wait(timeout: .now()+1) == .success)
        let saved = DispatchSemaphore(value: 0)
        writable.save("new-synthetic-token", interactive: true) { result in
            guard case .success = result else { fatalError("Explicit retry failed") }
            saved.signal()
        }
        precondition(saved.wait(timeout: .now()+1) == .success && writes == 2)
        testHTTPServer()
        print("PASS: blocked Keychain leaves caller responsive, deadlines complete once, workers stay bounded, credentials survive and explicit retry succeeds")
    }
}

func testHTTPServer() {
    let folder=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try! FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
    defer { try? FileManager.default.removeItem(at:folder) }
    try! Data("<h1>Calculator available</h1>".utf8).write(to:folder.appendingPathComponent("index.html"))
    try! JSONSerialization.data(withJSONObject:["assets":["index.html":"fixture"]]).write(to:folder.appendingPathComponent("SOURCE.json"))
    let release=DispatchSemaphore(value:0)
    let credentials=KeychainConnection(deadline:0.1){_,_ in release.wait();return .failure(.authorization)}
    let server=try! LocalCalculatorServer(root:folder,credentials:credentials)
    var status:[Int]=[]
    try! server.start { url in
        var api=URLRequest(url:URL(string:"/api/brainfood/math/classes",relativeTo:url)!)
        api.setValue(server.capability,forHTTPHeaderField:"X-Calculator-Capability")
        URLSession.shared.dataTask(with:api){data,response,error in DispatchQueue.main.async {
            precondition(error==nil && (response as? HTTPURLResponse)?.statusCode==503)
            precondition(String(data:data!,encoding:.utf8)!.contains("Keychain did not respond"))
            status.append(503)
        }}.resume()
        URLSession.shared.dataTask(with:url){data,response,error in DispatchQueue.main.async {
            precondition(error==nil && (response as? HTTPURLResponse)?.statusCode==200)
            precondition(String(data:data!,encoding:.utf8)=="<h1>Calculator available</h1>")
            status.append(200)
        }}.resume()
    }
    let end=Date().addingTimeInterval(3)
    while status.count<2 && Date()<end { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
    release.signal();server.listener?.cancel()
    precondition(status == [200,503], "A blocked Keychain request delayed real static HTTP")
}
