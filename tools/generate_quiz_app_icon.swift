import AppKit

struct Palette {
    let backgroundTop: NSColor
    let backgroundBottom: NSColor
    let orbTop: NSColor
    let orbBottom: NSColor
    let card: NSColor
    let text: NSColor
    let accent: NSColor
    let accentSecondary: NSColor
}

let size = CGSize(width: 1024, height: 1024)
let iconRect = CGRect(origin: .zero, size: size)
let cornerRadius: CGFloat = 224

func makeGradientImage(colors: [NSColor], in rect: CGRect, angle: CGFloat) {
    let gradient = NSGradient(colors: colors)!
    gradient.draw(in: NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius), angle: angle)
}

func fillRoundedRect(_ rect: CGRect, radius: CGFloat, color: NSColor, alpha: CGFloat = 1) {
    color.withAlphaComponent(alpha).setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func drawOrb(in rect: CGRect, palette: Palette) {
    let path = NSBezierPath(ovalIn: rect)
    let gradient = NSGradient(colors: [palette.orbTop, palette.orbBottom])!
    gradient.draw(in: path, relativeCenterPosition: .zero)
}

func drawLine(from start: CGPoint, to end: CGPoint, color: NSColor, width: CGFloat, alpha: CGFloat = 1) {
    let path = NSBezierPath()
    path.move(to: start)
    path.line(to: end)
    path.lineCapStyle = .round
    path.lineWidth = width
    color.withAlphaComponent(alpha).setStroke()
    path.stroke()
}

func drawCircle(center: CGPoint, radius: CGFloat, color: NSColor) {
    let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
    color.setFill()
    NSBezierPath(ovalIn: rect).fill()
}

func drawCard(in rect: CGRect, palette: Palette) {
    fillRoundedRect(rect, radius: 92, color: palette.card, alpha: 0.96)

    let lineX = rect.minX + 144
    let top = rect.maxY - 172
    let spacing: CGFloat = 112
    let textWidth: CGFloat = rect.width - 280
    for index in 0..<3 {
        let y = top - CGFloat(index) * spacing
        drawCircle(center: CGPoint(x: lineX - 54, y: y + 2), radius: 16, color: palette.accent)
        drawLine(
            from: CGPoint(x: lineX, y: y),
            to: CGPoint(x: lineX + textWidth, y: y),
            color: palette.text,
            width: 26,
            alpha: index == 0 ? 0.95 : 0.78
        )
        drawLine(
            from: CGPoint(x: lineX, y: y - 34),
            to: CGPoint(x: lineX + textWidth * (index == 2 ? 0.58 : 0.82), y: y - 34),
            color: palette.text,
            width: 18,
            alpha: 0.42
        )
    }
}

func drawPencil(in rect: CGRect, palette: Palette) {
    NSGraphicsContext.saveGraphicsState()
    let transform = NSAffineTransform()
    transform.translateX(by: rect.midX + 160, yBy: rect.midY - 18)
    transform.rotate(byDegrees: -32)
    transform.translateX(by: -rect.midX - 160, yBy: -rect.midY + 18)
    transform.concat()

    let body = NSBezierPath(roundedRect: CGRect(x: rect.midX - 34, y: rect.midY - 172, width: 68, height: 356), xRadius: 28, yRadius: 28)
    let bodyGradient = NSGradient(colors: [palette.accentSecondary, palette.accent])!
    bodyGradient.draw(in: body, angle: 90)

    fillRoundedRect(CGRect(x: rect.midX - 34, y: rect.midY + 124, width: 68, height: 60), radius: 24, color: NSColor.white, alpha: 0.82)
    fillRoundedRect(CGRect(x: rect.midX - 34, y: rect.midY + 168, width: 68, height: 16), radius: 8, color: palette.text, alpha: 0.22)

    let tipPath = NSBezierPath()
    tipPath.move(to: CGPoint(x: rect.midX - 34, y: rect.midY - 172))
    tipPath.line(to: CGPoint(x: rect.midX + 34, y: rect.midY - 172))
    tipPath.line(to: CGPoint(x: rect.midX, y: rect.midY - 264))
    tipPath.close()
    NSColor(calibratedRed: 0.97, green: 0.86, blue: 0.66, alpha: 1).setFill()
    tipPath.fill()

    let leadPath = NSBezierPath()
    leadPath.move(to: CGPoint(x: rect.midX - 10, y: rect.midY - 236))
    leadPath.line(to: CGPoint(x: rect.midX + 10, y: rect.midY - 236))
    leadPath.line(to: CGPoint(x: rect.midX, y: rect.midY - 264))
    leadPath.close()
    palette.text.setFill()
    leadPath.fill()
    NSGraphicsContext.restoreGraphicsState()
}

func writeIcon(to path: String, palette: Palette) throws {
    let image = NSImage(size: size)
    image.lockFocus()

    makeGradientImage(colors: [palette.backgroundTop, palette.backgroundBottom], in: iconRect, angle: 90)
    drawOrb(in: CGRect(x: 110, y: 560, width: 580, height: 580), palette: palette)
    drawOrb(in: CGRect(x: 610, y: 120, width: 260, height: 260), palette: palette)
    drawCard(in: CGRect(x: 150, y: 166, width: 724, height: 724), palette: palette)
    drawPencil(in: CGRect(x: 150, y: 166, width: 724, height: 724), palette: palette)

    image.unlockFocus()

    guard
        let tiffData = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData),
        let pngData = bitmap.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "IconGeneration", code: 1)
    }

    try pngData.write(to: URL(fileURLWithPath: path))
}

let outputDirectory = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "QuizSoragakiPad/QuizSoragakiPad/Assets.xcassets/AppIcon.appiconset"

let light = Palette(
    backgroundTop: NSColor(calibratedRed: 0.96, green: 0.98, blue: 1.0, alpha: 1),
    backgroundBottom: NSColor(calibratedRed: 0.78, green: 0.88, blue: 0.99, alpha: 1),
    orbTop: NSColor(calibratedRed: 0.52, green: 0.82, blue: 0.99, alpha: 0.56),
    orbBottom: NSColor(calibratedRed: 0.27, green: 0.54, blue: 0.88, alpha: 0.22),
    card: NSColor.white,
    text: NSColor(calibratedRed: 0.05, green: 0.09, blue: 0.16, alpha: 1),
    accent: NSColor(calibratedRed: 0.19, green: 0.52, blue: 0.9, alpha: 1),
    accentSecondary: NSColor(calibratedRed: 0.18, green: 0.84, blue: 0.78, alpha: 1)
)

let dark = Palette(
    backgroundTop: NSColor(calibratedRed: 0.06, green: 0.1, blue: 0.18, alpha: 1),
    backgroundBottom: NSColor(calibratedRed: 0.12, green: 0.23, blue: 0.38, alpha: 1),
    orbTop: NSColor(calibratedRed: 0.18, green: 0.73, blue: 0.98, alpha: 0.46),
    orbBottom: NSColor(calibratedRed: 0.22, green: 0.36, blue: 0.74, alpha: 0.26),
    card: NSColor(calibratedRed: 0.12, green: 0.16, blue: 0.24, alpha: 1),
    text: NSColor(calibratedRed: 0.93, green: 0.97, blue: 1.0, alpha: 1),
    accent: NSColor(calibratedRed: 0.42, green: 0.72, blue: 0.99, alpha: 1),
    accentSecondary: NSColor(calibratedRed: 0.23, green: 0.86, blue: 0.82, alpha: 1)
)

let tinted = Palette(
    backgroundTop: NSColor(calibratedWhite: 0.92, alpha: 1),
    backgroundBottom: NSColor(calibratedWhite: 0.74, alpha: 1),
    orbTop: NSColor(calibratedWhite: 0.68, alpha: 0.42),
    orbBottom: NSColor(calibratedWhite: 0.48, alpha: 0.22),
    card: NSColor(calibratedWhite: 0.98, alpha: 1),
    text: NSColor(calibratedWhite: 0.15, alpha: 1),
    accent: NSColor(calibratedWhite: 0.28, alpha: 1),
    accentSecondary: NSColor(calibratedWhite: 0.52, alpha: 1)
)

try writeIcon(to: "\(outputDirectory)/icon-light.png", palette: light)
try writeIcon(to: "\(outputDirectory)/icon-dark.png", palette: dark)
try writeIcon(to: "\(outputDirectory)/icon-tinted.png", palette: tinted)
