import AppKit
import WebKit
import Network
import Security

let keychainService = "io.netsecdev.neocalculator.math"
func deviceToken() -> String? {
    let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecAttrAccount as String:"device",kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary,&result)==errSecSuccess, let data=result as? Data else{return nil}
    return String(data:data,encoding:.utf8)
}
func saveToken(_ token:String) -> Bool {
    let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:keychainService,kSecAttrAccount as String:"device"]
    let data=Data(token.utf8)
    let result=SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
    if result==errSecSuccess{return true}
    if result != errSecItemNotFound{return false}
    var item=query;item[kSecValueData as String]=data;item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(item as CFDictionary,nil)==errSecSuccess
}
if CommandLine.arguments.contains("--configure-device") {
    let data=FileHandle.standardInput.readDataToEndOfFile()
    guard data.count<8192, let config=try? JSONSerialization.jsonObject(with:data) as? [String:String],let token=config["device_token"],!token.isEmpty,token.count<4096,saveToken(token) else{exit(1)}
    print("Device connection saved in Keychain.");exit(0)
}

final class NoRedirect:NSObject,URLSessionTaskDelegate {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
}
final class LocalCalculatorServer {
    let capability=UUID().uuidString+UUID().uuidString
    let session=URLSession(configuration:.ephemeral,delegate:NoRedirect(),delegateQueue:nil)
    let queue=DispatchQueue(label:"calculator.http")
    let root:URL
    var listener:NWListener?
    var port:UInt16=0
    var files:Set<String>
    init(root:URL) throws {
        self.root=root
        let source=try JSONSerialization.jsonObject(with:Data(contentsOf:root.appendingPathComponent("SOURCE.json"))) as? [String:Any]
        guard let assets=source?["assets"] as? [String:String] else{throw NSError(domain:"Calculator assets",code:1)}
        files=Set(assets.keys);files.insert("SOURCE.json")
    }
    func start(ready:@escaping(URL)->Void) throws {
        let parameters=NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
        let listener=try NWListener(using:parameters);self.listener=listener
        listener.stateUpdateHandler={state in
            if case .ready=state,let port=listener.port?.rawValue {
                self.port=port;DispatchQueue.main.async{ready(URL(string:"http://127.0.0.1:\(port)/index.html")!)}
            }
        }
        listener.newConnectionHandler={connection in
            connection.start(queue:self.queue)
            self.queue.asyncAfter(deadline:.now()+190){connection.cancel()}
            self.receive(connection,Data())
        }
        listener.start(queue:queue)
    }
    func receive(_ connection:NWConnection,_ buffered:Data) {
        connection.receive(minimumIncompleteLength:1,maximumLength:65536){data,_,complete,error in
            var bytes=buffered;if let data=data{bytes.append(data)}
            guard bytes.count<=80000 else{self.reply(connection,413,"text/plain",Data("Request too large".utf8));return}
            if let range=bytes.range(of:Data("\r\n\r\n".utf8)) {
                guard range.lowerBound<8192,let header=String(data:bytes[..<range.lowerBound],encoding:.utf8) else{connection.cancel();return}
                let lines=header.components(separatedBy:"\r\n");let first=lines[0].split(separator:" ").map(String.init)
                guard first.count==3 else{connection.cancel();return}
                var headers=[String:String]()
                for line in lines.dropFirst(){let parts=line.split(separator:":",maxSplits:1).map(String.init);if parts.count==2{let key=parts[0].lowercased();if headers[key] != nil{connection.cancel();return};headers[key]=parts[1].trimmingCharacters(in:.whitespaces)}}
                let length=Int(headers["content-length"] ?? "0") ?? -1
                guard length>=0,length<=70000,headers["transfer-encoding"]==nil else{self.reply(connection,400,"text/plain",Data());return}
                if bytes.count-range.upperBound>=length {
                    self.handle(connection,first[0],first[1],headers,Data(bytes[range.upperBound..<(range.upperBound+length)]));return
                }
            }else if bytes.count>8192{connection.cancel();return}
            if complete || error != nil{connection.cancel();return}
            self.receive(connection,bytes)
        }
    }
    func handle(_ c:NWConnection,_ method:String,_ target:String,_ headers:[String:String],_ body:Data) {
        let origin="http://127.0.0.1:\(port)"
        guard headers["host"]=="127.0.0.1:\(port)",let path=URLComponents(string:target)?.path else{reply(c,403,"text/plain",Data());return}
        let isRead = path=="/api/brainfood/math/models" || path=="/api/brainfood/math/classes" || path=="/api/brainfood/math/outputs" || path.range(of:"^/api/brainfood/math/outputs/[0-9a-f-]{36}$",options:.regularExpression) != nil
        let isWrite = path=="/api/brainfood/math/explain" || path.range(of:"^/api/brainfood/math/outputs/[0-9a-f-]{36}/feedback$",options:.regularExpression) != nil
        if isRead || isWrite {
            guard headers["x-calculator-capability"]==capability else{reply(c,403,"application/json",Data("{}".utf8));return}
            guard (isRead && method=="GET") || (isWrite && method=="POST" && headers["origin"]==origin) else{reply(c,403,"application/json",Data("{}".utf8));return}
            guard let token=deviceToken() else{reply(c,401,"application/json",Data("{}".utf8));return}
            var request=URLRequest(url:URL(string:"https://brainfood.silas-ai.io"+path)!)
            request.httpMethod=method;request.timeoutInterval=180;request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
            if method=="POST"{request.httpBody=body;request.setValue("application/json",forHTTPHeaderField:"Content-Type")}
            session.dataTask(with:request){data,response,error in
                guard error==nil,let response=response as? HTTPURLResponse,let data=data,data.count<=200000 else{self.reply(c,503,"application/json",Data("{}".utf8));return}
                guard response.url?.host=="brainfood.silas-ai.io",response.value(forHTTPHeaderField:"Content-Type")?.contains("application/json")==true else{self.reply(c,401,"application/json",Data("{}".utf8));return}
                self.reply(c,response.statusCode,"application/json",data)
            }.resume();return
        }
        let name=path=="/" ? "index.html" : String(path.dropFirst())
        guard method=="GET",files.contains(name),!name.contains("/"),let data=try? Data(contentsOf:root.appendingPathComponent(name)) else{reply(c,404,"text/plain",Data());return}
        let ext=(name as NSString).pathExtension
        let mime=["html":"text/html; charset=utf-8","js":"text/javascript","css":"text/css","json":"application/json","wasm":"application/wasm"][ext] ?? "text/plain"
        reply(c,200,mime,data)
    }
    func reply(_ c:NWConnection,_ status:Int,_ mime:String,_ body:Data) {
        let header="HTTP/1.1 \(status) Response\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var data=Data(header.utf8);data.append(body)
        c.send(content:data,completion:.contentProcessed{_ in c.cancel()})
    }
}
final class CalculatorApp:NSObject,NSApplicationDelegate,WKNavigationDelegate {
    var window:NSWindow!;var server:LocalCalculatorServer!;var localHost:String?
    func applicationDidFinishLaunching(_ note:Notification){
        do {
            let resources=Bundle.main.resourceURL!
            server=try LocalCalculatorServer(root:resources.appendingPathComponent("calculator"))
            window=NSWindow(contentRect:NSRect(x:0,y:0,width:1050,height:850),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            window.title="NeoCalculator — Learning Workspace";window.center()
            let config=WKWebViewConfiguration()
            let script="""
            (()=>{const original=window.fetch.bind(window);const capability='\(server.capability)';window.fetch=(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/brainfood/math/')){const headers=new Headers(options.headers||{});headers.set('X-Calculator-Capability',capability);return original(input,{...options,headers});}return original(input,options);};})();
            """
            config.userContentController.addUserScript(WKUserScript(source:script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
            let view=WKWebView(frame:window.contentView!.bounds,configuration:config);view.autoresizingMask=[.width,.height];view.navigationDelegate=self;window.contentView=view
            let bar=NSMenu();let item=NSMenuItem();let menu=NSMenu();menu.addItem(withTitle:"Open calculator emulator",action:#selector(openEmulator),keyEquivalent:"e");menu.addItem(.separator());menu.addItem(withTitle:"Quit NeoCalculator",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");item.submenu=menu;bar.addItem(item);NSApp.mainMenu=bar
            try server.start{url in self.localHost=url.absoluteString.replacingOccurrences(of:"/index.html",with:"");view.load(URLRequest(url:url))}
            window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        } catch {let alert=NSAlert();alert.messageText="Calculator files could not be opened.";alert.informativeText="Please reinstall the application.";alert.runModal();NSApp.terminate(nil)}
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if url.absoluteString.hasPrefix((localHost ?? "invalid")+"/"){decisionHandler(.allow);return}
        if action.navigationType == .linkActivated && url.scheme=="https"{NSWorkspace.shared.open(url)}
        decisionHandler(.cancel)
    }
    @objc func openEmulator(){
        let process=Process();process.executableURL=Bundle.main.executableURL!.deletingLastPathComponent().appendingPathComponent("numos")
        var env=ProcessInfo.processInfo.environment;env["DYLD_LIBRARY_PATH"]=Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks").path;process.environment=env
        let state=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/NeoCalculator")
        try? FileManager.default.createDirectory(at:state,withIntermediateDirectories:true);process.currentDirectoryURL=state
        do{try process.run()}catch{let alert=NSAlert();alert.messageText="The emulator could not start.";alert.runModal()}
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
}
let app=NSApplication.shared;app.setActivationPolicy(.regular);let delegate=CalculatorApp();app.delegate=delegate;app.run()
