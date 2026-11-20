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
        testCoalescedReads()
        testReadBatchDeadline()
        testOldReadTimerDuringSave()
        testWorkspaceRecovery()
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
    // Both responses arrived while Security remained blocked. URLSession is
    // free to deliver independent completions in either order.
    precondition(Set(status) == Set([200,503]), "A blocked Keychain request delayed real static HTTP")
}


private final class RecoveryTestApp:CalculatorApp {
    var reloads=0,confirmations=0,approve=false,messages=[String]()
    override func reloadWorkspace(){reloads += 1}
    override func confirmConnectionReload(_ completion:@escaping(Bool)->Void){confirmations += 1;completion(approve)}
    override func connectionMessage(_ title:String,_ detail:String){messages.append(title+" "+detail)}
}
private func testWorkspaceRecovery(){
    var writes=0
    let app=RecoveryTestApp(credentials:KeychainConnection { token,interactive in
        precondition(interactive)
        if token != nil {writes += 1}
        return .success(token ?? "saved-synthetic-token")
    })
    func settle(){
        let end=Date().addingTimeInterval(2)
        while app.pairingInFlight && Date()<end{RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
        precondition(!app.pairingInFlight)
    }
    app.unlockConnection();settle()
    precondition(app.reloads==0 && writes==0 && app.messages.last!.contains("Retry classes"),"Unlock must preserve open notes")
    app.pendingToken="new-synthetic-token"
    app.retryConnectionSave();settle()
    precondition(app.confirmations==1 && app.reloads==0 && writes==0 && app.pendingToken != nil,"Cancel must preserve pending connection and work")
    app.unlockConnection();settle()
    precondition(app.confirmations==2 && app.reloads==0 && writes==0,"Unlock must not bypass a pending-save confirmation")
    app.approve=true;app.retryConnectionSave();settle()
    precondition(app.confirmations==3 && writes==1 && app.reloads==1 && app.pendingToken==nil,"Only a confirmed retry may save and reload")
    print("PASS: unlock preserves workspace; cancelled retry and pending unlock cannot save/reload; confirmed retry succeeds")
}


private func testCoalescedReads(){
    let release=DispatchSemaphore(value:0),entered=DispatchSemaphore(value:0),done=DispatchSemaphore(value:0)
    var calls=0
    let store=KeychainConnection(deadline:2){token,interactive in
        precondition(token==nil && !interactive);calls += 1;entered.signal();release.wait();return .success("coalesced-synthetic-token")
    }
    for _ in 0..<16 {store.read {result in
        guard case .success("coalesced-synthetic-token")=result else{fatalError("Cold-start readers must share success")}
        done.signal()
    }}
    precondition(entered.wait(timeout:.now()+1) == .success)
    var rejected=0
    let reject:(KeychainConnection.Outcome)->Void={result in
        guard case .failure(.busy)=result else{fatalError("Overflow, writes and explicit unlock must not join")};rejected += 1
    }
    store.read(completion:reject)
    store.save("different-synthetic-token",completion:reject)
    store.read(interactive:true,completion:reject)
    precondition(rejected==3)
    release.signal()
    for _ in 0..<16 {precondition(done.wait(timeout:.now()+1) == .success)}
    precondition(calls==1)
    print("PASS:16 cold-start reads share one result; overflow, writes and explicit unlock cannot join")
}
private func testReadBatchDeadline(){
    let release=DispatchSemaphore(value:0),returned=DispatchSemaphore(value:0),timedOut=DispatchSemaphore(value:0)
    let countLock=NSLock();var completions=0
    let store=KeychainConnection(deadline:0.05){_,_ in release.wait();returned.signal();return .success("late-batch-token")}
    for _ in 0..<3 {store.read {result in
        guard case .failure(.timeout)=result else{fatalError("Each joined reader must time out")}
        countLock.lock();completions += 1;countLock.unlock();timedOut.signal()
    }}
    for _ in 0..<3 {precondition(timedOut.wait(timeout:.now()+1) == .success)}
    var closed=false
    store.read {result in if case .failure(.busy)=result {closed=true}}
    precondition(closed,"Timed-out batches must refuse new callbacks")
    release.signal();precondition(returned.wait(timeout:.now()+1) == .success)
    var cached=false;let end=Date().addingTimeInterval(1)
    while !cached && Date()<end {
        store.read {result in if case .success("late-batch-token")=result {cached=true}}
        Thread.sleep(forTimeInterval:0.005)
    }
    precondition(cached,"Late success may populate the cache")
    countLock.lock();precondition(completions==3,"Late result delivered a callback twice");countLock.unlock()
    print("PASS: batch deadline resolves all once, closes joins, and permits late cache without redelivery")
}


private func testOldReadTimerDuringSave(){
    let first=DispatchSemaphore(value:0),writing=DispatchSemaphore(value:0),release=DispatchSemaphore(value:0),saved=DispatchSemaphore(value:0)
    let counter=NSLock();var saveCompletions=0
    let store=KeychainConnection(deadline:0.05){token,interactive in
        if let token=token {precondition(interactive);writing.signal();release.wait();return .success(token)}
        return .success("existing-cache-token")
    }
    store.read {result in guard case .success=result else{fatalError("Initial read failed")};first.signal()}
    precondition(first.wait(timeout:.now()+1) == .success)
    store.save("replacement-cache-token",interactive:true){result in
        guard case .success("replacement-cache-token")=result else{fatalError("Old read timer completed a newer save")}
        counter.lock();saveCompletions += 1;counter.unlock();saved.signal()
    }
    precondition(writing.wait(timeout:.now()+1) == .success)
    var priorCache=false
    store.read {result in if case .success("existing-cache-token")=result{priorCache=true}}
    precondition(priorCache,"Existing cache policy changed during a pending save")
    Thread.sleep(forTimeInterval:0.15)
    counter.lock();precondition(saveCompletions==0);counter.unlock()
    release.signal();precondition(saved.wait(timeout:.now()+1) == .success)
    var newCache=false
    store.read {result in if case .success("replacement-cache-token")=result{newCache=true}}
    precondition(newCache)
    print("PASS: an old read deadline cannot complete a newer save; existing cache policy is preserved")
}
