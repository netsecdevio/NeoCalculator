// Generates or verifies public calculator handoff QR images locally on macOS.
// No external service, account identifier, student work or credential is used.
import AppKit
import CoreImage
import Vision

let arguments = CommandLine.arguments.dropFirst()
let folder = URL(fileURLWithPath: arguments.first(where: { !$0.hasPrefix("--") }) ?? "wasm/phone", isDirectory: true)
let verifyOnly = arguments.contains("--verify")
let context = CIContext()
for style in ["silas", "graphing", "scientific"] {
    let target = "https://famclaw.silas-ai.io/dashboard/lessons/calculator/emulator/index.html?persistence=disabled&style=\(style)"
    let file = folder.appendingPathComponent("qr-\(style).png")
    if !verifyOnly {
        let generator = CIFilter(name: "CIQRCodeGenerator")!
        generator.setValue(Data(target.utf8), forKey: "inputMessage")
        generator.setValue("M", forKey: "inputCorrectionLevel")
        let qr = generator.outputImage!
        let padded = qr.composited(over: CIImage(color: .white)).cropped(to: qr.extent.insetBy(dx: -4, dy: -4))
        let scaled = padded.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let image = context.createCGImage(scaled, from: scaled.extent)!
        let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
        try png.write(to: file, options: .atomic)
    }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try VNImageRequestHandler(url: file).perform([request])
    guard request.results?.count == 1 && request.results?.first?.payloadStringValue == target else {
        FileHandle.standardError.write(Data("QR does not decode to its exact public calculator URL: \(style)\n".utf8))
        exit(1)
    }
    print("Verified offline handoff QR: \(style)")
}
