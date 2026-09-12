import Foundation
import Vision
import ImageIO
import CoreGraphics

/**
 * OpenScreen macOS Vision OCR helper — reads one still, prints JSON to stdout.
 * Platform adapter only; cognition code must not import Vision directly.
 *
 * Output shape:
 * { "engine":"macos_vision", "width":N, "height":N, "lines":[{text,confidence,x,y,w,h}] }
 */

guard CommandLine.arguments.count >= 2 else {
	fputs("usage: openscreen-vision-ocr <imagePath>\n", stderr)
	exit(2)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
	let cg = CGImageSourceCreateImageAtIndex(src, 0, nil)
else {
	fputs("failed to load image via ImageIO\n", stderr)
	exit(3)
}

final class Box {
	var error: Error?
	var lines: [[String: Any]] = []
}

let box = Box()
let sem = DispatchSemaphore(value: 0)
DispatchQueue.global(qos: .userInitiated).async {
	let request = VNRecognizeTextRequest { req, err in
		if let err {
			box.error = err
			sem.signal()
			return
		}
		let results = (req.results as? [VNRecognizedTextObservation]) ?? []
		for obs in results {
			guard let top = obs.topCandidates(1).first else { continue }
			let b = obs.boundingBox
			box.lines.append([
				"text": top.string,
				"confidence": Double(top.confidence),
				"x": b.origin.x,
				"y": b.origin.y,
				"w": b.size.width,
				"h": b.size.height,
			])
		}
		sem.signal()
	}
	request.recognitionLevel = .accurate
	request.usesLanguageCorrection = false
	let handler = VNImageRequestHandler(cgImage: cg, options: [:])
	do {
		try handler.perform([request])
	} catch {
		box.error = error
		sem.signal()
	}
}

if sem.wait(timeout: .now() + 45) == .timedOut {
	fputs("vision timed out\n", stderr)
	exit(5)
}

if let err = box.error {
	fputs("vision failed: \(err)\n", stderr)
	exit(4)
}

let payload: [String: Any] = [
	"engine": "macos_vision",
	"width": cg.width,
	"height": cg.height,
	"lines": box.lines,
]
do {
	let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
	FileHandle.standardOutput.write(data)
	fputs("\n", stdout)
} catch {
	fputs("json encode failed: \(error)\n", stderr)
	exit(6)
}
