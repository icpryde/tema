// Tema — WebKit extension harness.
//
// Loads a web extension into WebKit's own extension runtime (WKWebExtension,
// the engine under Safari's extensions) and drives it from stdin, so the
// Safari build can be tested end to end without Safari: no extension to
// enable, no website access to grant, nobody at the keyboard.
//
//   harness <extension dir> [--proxy <port>] [--ask]
//
// --ask starts the way Safari does: the extension gets its permissions but
// no website access, and a request for access (permissions.request) is put
// to this harness as Safari would put it to you; the "answer" command
// decides whether it is allowed.
//
// --proxy sends every request through an HTTP CONNECT proxy on 127.0.0.1,
// which is how tools/tests/safari.mjs serves its stand-in pages at the real
// hostnames (https://claude.ai/ and friends), so the manifest's own matches
// decide what gets injected. Server certificates are trusted blindly: this
// only ever talks to that proxy.
//
// Commands, one JSON object per line on stdin; one JSON reply per line on
// stdout ({"id": …, "ok": true, "value": …} or {"id": …, "ok": false, "error": …}):
//
//   {"id":1,"cmd":"open","tab":"claude","url":"https://claude.ai/"}   a page
//   {"id":2,"cmd":"popup","tab":"popup","path":"src/popup/popup.html"} an extension page
//   {"id":3,"cmd":"eval","tab":"claude","js":"return document.title"}   async function body,
//                                                                       run in the page's world
//   {"id":4,"cmd":"probe","url":"file:///…","prefix":"PROBE:",         load a file in a plain
//    "width":800,"height":600}                                          view, wait for a title
//                                                                       with that prefix
//   {"id":5,"cmd":"errors"}                                            the extension context's errors
//   {"id":6,"cmd":"prompts"}                                           permission prompts seen so far
//   {"id":7,"cmd":"answer","grant":false}                              how to answer the next prompts
//   {"id":9,"cmd":"snapshot","tab":"claude","path":"/…/shot.png"}      a PNG of what the tab shows
//   {"id":8,"cmd":"quit"}

import AppKit
import Network
import WebKit

setvbuf(stdout, nil, _IOLBF, 0)

func reply(_ object: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

/// JSON-safe copy of whatever evaluateJavaScript handed back.
func plain(_ value: Any?) -> Any {
    guard let value else { return NSNull() }
    if value is NSNull { return NSNull() }
    if let v = value as? String { return v }
    if let v = value as? NSNumber { return v }
    if let v = value as? [Any] { return v.map { plain($0) } }
    if let v = value as? [String: Any] { return v.mapValues { plain($0) } }
    return String(describing: value)
}

@MainActor
final class Harness: NSObject, WKNavigationDelegate, WKWebExtensionControllerDelegate, WKUIDelegate {
    let controller: WKWebExtensionController
    let context: WKWebExtensionContext
    let store: WKWebsiteDataStore
    var views: [String: WKWebView] = [:]
    var loads: [ObjectIdentifier: CheckedContinuation<Void, Error>] = [:]
    var prompts: [String] = []
    var grantPrompts = true
    var window: NSWindow

    init(extensionURL: URL, proxyPort: UInt16?, ask: Bool) async throws {
        let ext = try await WKWebExtension(resourceBaseURL: extensionURL)
        context = WKWebExtensionContext(for: ext)
        // Grant what the extension asks for, as a person would on install.
        for permission in ext.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: permission)
        }
        if !ask {
            for pattern in ext.allRequestedMatchPatterns {
                context.setPermissionStatus(.grantedExplicitly, for: pattern)
            }
        }
        // The pages use a non-persistent data store, which WebKit treats as
        // private browsing, where extensions only run when allowed to.
        context.hasAccessToPrivateData = true
        controller = WKWebExtensionController(configuration: .nonPersistent())
        store = WKWebsiteDataStore.nonPersistent()
        if let proxyPort, let port = NWEndpoint.Port(rawValue: proxyPort) {
            store.proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: port))]
        }
        // One real (offscreen-sized, never shown) window so pages lay out at a
        // desktop size; hidden views still render, with throttled timers.
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        controller.delegate = self
        try controller.load(context)
    }

    func newView(_ configuration: WKWebViewConfiguration) -> WKWebView {
        // Nobody ever sees these views, and WebKit throttles the timers of
        // hidden pages and suspends their processes; pages under test have to
        // run as if they were in front. (WebKit SPI, harmless where missing.)
        let prefs = configuration.preferences
        setPrivate(prefs, "_setHiddenPageDOMTimerThrottlingEnabled:", false)
        setPrivate(prefs, "_setHiddenPageDOMTimerThrottlingAutoIncreases:", false)
        setPrivate(prefs, "_setPageVisibilityBasedProcessSuppressionEnabled:", false)
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 860), configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isInspectable = true
        window.contentView?.addSubview(view)
        return view
    }

    func open(tab: String, url: URL) async throws {
        let configuration = WKWebViewConfiguration()
        configuration.webExtensionController = controller
        configuration.websiteDataStore = store
        let view = views[tab] ?? newView(configuration)
        views[tab] = view
        try await load(view, URLRequest(url: url))
    }

    func popup(tab: String, path: String) async throws {
        guard let configuration = context.webViewConfiguration else { throw HarnessError("no extension web view configuration") }
        let view = views[tab] ?? newView(configuration)
        views[tab] = view
        try await load(view, URLRequest(url: context.baseURL.appendingPathComponent(path)))
    }

    func load(_ view: WKWebView, _ request: URLRequest) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loads[ObjectIdentifier(view)] = c
            if request.url?.isFileURL == true, let url = request.url {
                view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent())
            } else {
                view.load(request)
            }
        }
    }

    func eval(tab: String, js: String) async throws -> Any? {
        guard let view = views[tab] else { throw HarnessError("no tab \(tab)") }
        return try await view.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page)
    }

    func probe(url: URL, prefix: String, timeout: Double, size: NSSize) async throws -> String {
        // The probe pages read their own file:// stylesheets' rules, which
        // WebKit treats as cross-origin unless told otherwise (Chrome's
        // --allow-file-access-from-files).
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        configuration.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        let view = newView(configuration)
        view.frame = NSRect(origin: .zero, size: size)
        defer { view.removeFromSuperview() }
        try await load(view, URLRequest(url: url))
        let end = Date().addingTimeInterval(timeout)
        // Wait on WKWebView's title property, which runs no script: script run
        // through evaluateJavaScript counts as a user gesture and would hand
        // the page the user activation the pages under test must not have.
        // That property is cut to about a thousand characters, so once the
        // report is there it is read in full, once, through document.title.
        while Date() < end {
            if let title = view.title, title.hasPrefix(prefix) {
                return (try await view.evaluateJavaScript("document.title")) as? String ?? title
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw HarnessError("the page never reported (\((view.title ?? "no title").prefix(200)))")
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume(throwing: error)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume(throwing: error)
    }
    func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        if let trust = challenge.protectionSpace.serverTrust { return (.useCredential, URLCredential(trust: trust)) }
        return (.performDefaultHandling, nil)
    }

    // MARK: extension controller

    func webExtensionController(_ controller: WKWebExtensionController,
                                promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext)
        async -> (Set<WKWebExtension.MatchPattern>, Date?) {
        prompts.append(contentsOf: matchPatterns.map { $0.string })
        return (grantPrompts ? matchPatterns : [], nil)
    }
}

/// Call a private BOOL setter, if the object has it.
func setPrivate(_ object: NSObject, _ selectorName: String, _ value: Bool) {
    let selector = NSSelectorFromString(selectorName)
    guard object.responds(to: selector) else { return }
    typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
    unsafeBitCast(object.method(for: selector), to: Setter.self)(object, selector, value)
}

struct HarnessError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: harness <extension dir> [--proxy <port>] [--ask]\n".utf8))
    exit(2)
}
// Absolute: a relative file URL keeps the working directory as a separate
// base, and WKWebExtension reads it without the base, finds no scheme and
// trips a release assertion ("URL is valid") instead of returning an error.
let extensionURL = URL(fileURLWithPath: args[1], isDirectory: true).absoluteURL
var proxyPort: UInt16? = nil
if let i = args.firstIndex(of: "--proxy"), i + 1 < args.count { proxyPort = UInt16(args[i + 1]) }
let ask = args.contains("--ask")

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task { @MainActor in
    do {
        let harness = try await Harness(extensionURL: extensionURL, proxyPort: proxyPort, ask: ask)
        reply(["id": "ready", "ok": true, "value": ["baseURL": harness.context.baseURL.absoluteString]])
        // stdin is read on a background thread so the main run loop keeps
        // turning for WebKit; each command still runs on the main actor.
        Thread.detachNewThread {
            while let line = readLine() {
                let semaphore = DispatchSemaphore(value: 0)
                Task { @MainActor in
                    await handle(line, harness)
                    semaphore.signal()
                }
                semaphore.wait()
            }
            exit(0)
        }
    } catch {
        reply(["id": "ready", "ok": false, "error": String(describing: error)])
        exit(1)
    }
}
app.run()

@MainActor @Sendable
func handle(_ line: String, _ harness: Harness) async {
    guard let data = line.data(using: .utf8),
          let cmd = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
    let id = cmd["id"] ?? NSNull()
    do {
        switch cmd["cmd"] as? String {
        case "open":
            try await harness.open(tab: cmd["tab"] as? String ?? "main", url: URL(string: cmd["url"] as? String ?? "")!)
            reply(["id": id, "ok": true])
        case "popup":
            try await harness.popup(tab: cmd["tab"] as? String ?? "popup", path: cmd["path"] as? String ?? "")
            reply(["id": id, "ok": true])
        case "eval":
            let value = try await harness.eval(tab: cmd["tab"] as? String ?? "main", js: cmd["js"] as? String ?? "")
            reply(["id": id, "ok": true, "value": plain(value)])
        case "probe":
            let title = try await harness.probe(url: URL(string: cmd["url"] as? String ?? "")!,
                                                prefix: cmd["prefix"] as? String ?? "",
                                                timeout: cmd["timeout"] as? Double ?? 15,
                                                size: NSSize(width: cmd["width"] as? Double ?? 800,
                                                             height: cmd["height"] as? Double ?? 600))
            reply(["id": id, "ok": true, "value": title])
        case "errors":
            reply(["id": id, "ok": true, "value": harness.context.errors.map { String(describing: $0) }])
        case "prompts":
            reply(["id": id, "ok": true, "value": harness.prompts])
        case "answer":
            harness.grantPrompts = cmd["grant"] as? Bool ?? true
            reply(["id": id, "ok": true])
        case "snapshot":
            guard let view = harness.views[cmd["tab"] as? String ?? ""] else { throw HarnessError("no such tab") }
            if let w = cmd["width"] as? Double, let h = cmd["height"] as? Double {
                view.frame = NSRect(x: 0, y: 0, width: w, height: h)
            }
            let image = try await view.takeSnapshot(configuration: nil)
            guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { throw HarnessError("no image") }
            try png.write(to: URL(fileURLWithPath: cmd["path"] as? String ?? ""))
            reply(["id": id, "ok": true])
        case "quit":
            reply(["id": id, "ok": true])
            exit(0)
        default:
            reply(["id": id, "ok": false, "error": "unknown command"])
        }
    } catch {
        reply(["id": id, "ok": false, "error": String(describing: error)])
    }
}
