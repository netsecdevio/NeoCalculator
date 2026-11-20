import AppKit
import WebKit
import Network
import Security

final class NoRedirect:NSObject,URLSessionTaskDelegate {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
}
final class LocalCalculatorServer {
    let capability=UUID().uuidString+UUID().uuidString
    let session=URLSession(configuration:.ephemeral,delegate:NoRedirect(),delegateQueue:nil)
    let queue=DispatchQueue(label:"calculator.http")
    let credentials:KeychainConnection
    let root:URL
    var listener:NWListener?
    var port:UInt16=0
    var files:Set<String>
    init(root:URL,credentials:KeychainConnection) throws {
        self.root=root;self.credentials=credentials
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
            credentials.read { result in
                guard case .success(let token) = result else {
                    if case .failure(let failure) = result {
                        let data=(try? JSONSerialization.data(withJSONObject:["detail":failure.message])) ?? Data("{}".utf8)
                        let status:Int;if case .missing=failure{status=401}else{status=503}
                        self.reply(c,status,"application/json",data)
                    }
                    return
                }
                var request=URLRequest(url:URL(string:"https://brainfood.silas-ai.io"+path)!)
                request.httpMethod=method;request.timeoutInterval=180;request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
                if method=="POST"{request.httpBody=body;request.setValue("application/json",forHTTPHeaderField:"Content-Type")}
                self.session.dataTask(with:request){data,response,error in
                    guard error==nil,let response=response as? HTTPURLResponse,let data=data,data.count<=200000 else{self.reply(c,503,"application/json",Data("{}".utf8));return}
                    guard response.url?.host=="brainfood.silas-ai.io",response.value(forHTTPHeaderField:"Content-Type")?.contains("application/json")==true else{self.reply(c,401,"application/json",Data("{}".utf8));return}
                    self.reply(c,response.statusCode,"application/json",data)
                }.resume()
            }
            return
        }
        let name=path=="/" ? "index.html" : String(path.dropFirst())
        guard method=="GET",files.contains(name),!name.contains("/"),let data=try? Data(contentsOf:root.appendingPathComponent(name)) else{reply(c,404,"text/plain",Data());return}
        let ext=(name as NSString).pathExtension
        let mime=["html":"text/html; charset=utf-8","js":"text/javascript","css":"text/css","json":"application/json","wasm":"application/wasm","woff2":"font/woff2","png":"image/png"][ext] ?? "text/plain"
        reply(c,200,mime,data)
    }
    func reply(_ c:NWConnection,_ status:Int,_ mime:String,_ body:Data) {
        let header="HTTP/1.1 \(status) Response\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var data=Data(header.utf8);data.append(body)
        c.send(content:data,completion:.contentProcessed{_ in c.cancel()})
    }
}
class CalculatorApp:NSObject,NSApplicationDelegate,WKNavigationDelegate {
    var window:NSWindow!;var server:LocalCalculatorServer!;var localHost:String?;var workspace:WKWebView?
    var pairingInFlight=false
    let credentials:KeychainConnection
    init(credentials:KeychainConnection=KeychainConnection()){self.credentials=credentials;super.init()}
    var pendingToken:String?
    let pairingSession=URLSession(configuration:.ephemeral,delegate:NoRedirect(),delegateQueue:nil)
    func applicationDidFinishLaunching(_ note:Notification){
        NSApp.appearance=NSAppearance(named:.darkAqua)
        do {
            let resources=Bundle.main.resourceURL!
            server=try LocalCalculatorServer(root:resources.appendingPathComponent("calculator"),credentials:credentials)
            window=NSWindow(contentRect:NSRect(x:0,y:0,width:1050,height:850),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            window.title="silascalc";window.center()
            let config=WKWebViewConfiguration()
            let script="""
            (()=>{const original=window.fetch.bind(window);const capability='\(server.capability)';window.fetch=(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/brainfood/math/')){const headers=new Headers(options.headers||{});headers.set('X-Calculator-Capability',capability);return original(input,{...options,headers});}return original(input,options);};})();
            """
            config.userContentController.addUserScript(WKUserScript(source:script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
            let view=WKWebView(frame:window.contentView!.bounds,configuration:config);view.autoresizingMask=[.width,.height];view.navigationDelegate=self;window.contentView=view;workspace=view
            let bar=NSMenu();let item=NSMenuItem();let menu=NSMenu();menu.addItem(withTitle:"Connect to Silas…",action:#selector(connectToSilas),keyEquivalent:",");menu.addItem(withTitle:"Unlock saved connection…",action:#selector(unlockConnection),keyEquivalent:"u");menu.addItem(withTitle:"Retry saving connection…",action:#selector(retryConnectionSave),keyEquivalent:"");menu.addItem(withTitle:"Open silascalc simulator",action:#selector(openEmulator),keyEquivalent:"e");menu.addItem(.separator());menu.addItem(withTitle:"Quit silascalc",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");item.submenu=menu;bar.addItem(item);NSApp.mainMenu=bar
            try server.start{url in self.localHost=url.absoluteString.replacingOccurrences(of:"/index.html",with:"");view.load(URLRequest(url:url))}
            window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        } catch {let alert=NSAlert();alert.messageText="Calculator files could not be opened.";alert.informativeText="Please reinstall the application.";alert.runModal();NSApp.terminate(nil)}
    }
    @objc func connectToSilas(){
        guard !pairingInFlight else{return}
        if pendingToken != nil { retryConnectionSave(); return }
        let alert=NSAlert();alert.messageText="Connect silascalc to your classes"
        alert.informativeText="Enter the setup code from your parent or teacher. Save or submit any open notes first: connecting reloads this workspace."
        alert.addButton(withTitle:"Connect");alert.addButton(withTitle:"Cancel")
        let field=NSSecureTextField(frame:NSRect(x:0,y:0,width:300,height:28));field.placeholderString="Setup code";field.setAccessibilityLabel("Silas setup code");alert.accessoryView=field
        alert.window.initialFirstResponder=field
        guard alert.runModal() == .alertFirstButtonReturn else{field.stringValue="";return}
        let code=field.stringValue.filter{!$0.isWhitespace && $0 != "-"};field.stringValue=""
        guard code.range(of:"^([0-9]{6}|[0-9]{8})$",options:.regularExpression) != nil else{connectionMessage("Check the setup code","Enter the 6 or 8 digits from your parent or teacher.");return}
        pairingInFlight=true;window.title="silascalc — Connecting…"
        var request=URLRequest(url:URL(string:"https://brainfood.silas-ai.io/api/devices/claim")!);request.httpMethod="POST";request.timeoutInterval=30
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        request.httpBody=try? JSONSerialization.data(withJSONObject:["code":code,"device_name":"silascalc for Mac"])
        pairingSession.dataTask(with:request){data,response,error in
            var message="Could not connect. Check your internet connection and try again."
            var acceptedToken:String?
            if error==nil,let response=response as? HTTPURLResponse {
                switch response.statusCode {
                case 404:message="That code was not found. Check it or ask for a new setup code."
                case 409:message="That code was already used. Ask for a new setup code."
                case 410:message="That code expired. Ask for a new setup code."
                case 429:message="Too many attempts. Wait a little before trying again."
                default:break
                }
                if response.statusCode==200,response.url?.host=="brainfood.silas-ai.io",response.url?.path=="/api/devices/claim",response.value(forHTTPHeaderField:"Content-Type")?.contains("application/json")==true,
                   let data=data,data.count<65536,let value=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let token=value["device_token"] as? String,!token.isEmpty,token.count<4096,
                   let device=value["device_id"] as? String,!device.isEmpty {
                    acceptedToken=token
                }
            }
            DispatchQueue.main.async {
                self.pairingInFlight=false;self.window?.title="silascalc"
                if let token=acceptedToken {self.pendingToken=token;self.persistConnection(interactive:false)}
                else{self.connectionMessage("Connection not completed",message)}
            }
        }.resume()
    }
    func persistConnection(interactive:Bool) {
        guard !pairingInFlight,let token=pendingToken else{return}
        pairingInFlight=true;window?.title="silascalc — Saving connection…"
        credentials.save(token,interactive:interactive){result in DispatchQueue.main.async {
            self.pairingInFlight=false;self.window?.title="silascalc"
            switch result {
            case .success:
                self.pendingToken=nil;self.reloadWorkspace()
                self.connectionMessage("Connected to Silas","Your connection is saved securely on this Mac.")
            case .failure(let failure):
                self.connectionMessage("Setup accepted — save still needed",failure.message+" Your setup code was accepted. Keep this app open and choose Retry saving connection; you do not need another code.")
            }
        }}
    }
    @objc func retryConnectionSave() {
        guard !pairingInFlight else{return}
        guard pendingToken != nil else{connectionMessage("No pending connection","Choose Unlock saved connection to use an existing connection, or Connect to Silas for a new setup code.");return}
        pairingInFlight=true
        confirmConnectionReload { approved in
            self.pairingInFlight=false
            if approved {self.persistConnection(interactive:true)}
        }
    }
    func confirmConnectionReload(_ completion:@escaping(Bool)->Void){
        let alert=NSAlert();alert.messageText="Save your work before continuing"
        alert.informativeText="Save or copy any open notes first. Saving this connection reloads the workspace. Choose Cancel to keep working, then retry when you are ready."
        alert.addButton(withTitle:"Cancel");alert.addButton(withTitle:"Continue and reload")
        alert.beginSheetModal(for:window){completion($0 == .alertSecondButtonReturn)}
    }
    func reloadWorkspace(){workspace?.reload()}
    @objc func unlockConnection() {
        guard !pairingInFlight else{return}
        if pendingToken != nil{retryConnectionSave();return}
        pairingInFlight=true;window?.title="silascalc — Unlocking connection…"
        credentials.read(interactive:true){result in DispatchQueue.main.async {
            self.pairingInFlight=false;self.window?.title="silascalc"
            switch result {
            case .success:self.connectionMessage("Connection unlocked","Your saved connection is ready. Choose Retry classes to reconnect without losing your open work.")
            case .failure(let failure):self.connectionMessage("Connection not unlocked",failure.message)
            }
        }}
    }
    func connectionMessage(_ title:String,_ detail:String){let alert=NSAlert();alert.messageText=title;alert.informativeText=detail;alert.addButton(withTitle:"OK");alert.beginSheetModal(for:window)}
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
#if !KEYCHAIN_TESTS
@main
struct LearningCalculator {
    static func main() {
        if CommandLine.arguments.contains("--connection-status") {
            let signal=DispatchSemaphore(value:0);let connection=KeychainConnection()
            connection.read { result in
                let status:[String:Any]
                switch result {
                case .success:status=["connected":true]
                case .failure(let failure):status=["connected":false,"action":failure.message]
                }
                if let data=try? JSONSerialization.data(withJSONObject:status){FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data("\n".utf8))}
                signal.signal()
            }
            signal.wait();return
        }
        if CommandLine.arguments.contains("--configure-device") {
            let data=FileHandle.standardInput.readDataToEndOfFile()
            guard data.count<8192,let config=try? JSONSerialization.jsonObject(with:data) as? [String:String],let token=config["device_token"],!token.isEmpty,token.count<4096 else{exit(1)}
            let signal=DispatchSemaphore(value:0)
            var success=false
            let connection=KeychainConnection()
            connection.save(token){result in
                if case .success=result{success=true}
                signal.signal()
            }
            signal.wait()
            if success{print("Device connection saved in Keychain.");exit(0)}
            FileHandle.standardError.write(Data("Keychain save unavailable. Use the app's Connect/Unlock menu to authorize the connection.\n".utf8));exit(1)
        }
        let app=NSApplication.shared;app.setActivationPolicy(.regular)
        let delegate=CalculatorApp();app.delegate=delegate;app.run()
    }
}

#endif
