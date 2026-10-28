// Aurora for iPhone: the main view controller. Registers Aurora's own native plugin
// and makes the web view feel native (no zoom, dark keyboard, edge-to-edge).
import UIKit
import Capacitor
import WebKit

class AuroraViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AuroraDLPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 11 / 255, green: 11 / 255, blue: 20 / 255, alpha: 1)
        if let wv = webView {
            wv.isOpaque = false
            wv.backgroundColor = view.backgroundColor
            wv.scrollView.backgroundColor = view.backgroundColor
            wv.scrollView.bounces = false
            wv.scrollView.contentInsetAdjustmentBehavior = .never
            wv.allowsBackForwardNavigationGestures = false
            if #available(iOS 16.4, *) { wv.isInspectable = true }
        }
        overrideUserInterfaceStyle = .dark
        setStatusBarStyle(.lightContent)
    }
}
