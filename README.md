# SVG 2 GCode Converter 🛠️🌀

A professional, lightweight, and fast desktop tool to convert **SVG files to G-Code**, designed for precision CNC machining.

![SVG to GCode Preview](https://raw.githubusercontent.com/tauri-apps/tauri/dev/app-icon.png) <!-- Placeholder, replace with real screenshot after build -->

## 🌟 Key Features

- **Tool Radius Compensation (Offset)**: No more manual path shifting. Choose from:
  - `Inside` - perfect for holes and pockets.
  - `Outside` - for precise outer dimensions.
  - `On-line` - standard path tracking.
- **Bezier Curve Support**: Advanced linearization algorithm for `C` and `Q` curves for maximum machine motion smoothness.
- **Full Parameter Control**:
  - Configure spindle speed (RPM).
  - Precise feed rate and plunge rate settings.
  - Define safe Z height and milling depth.
- **Modern Design**: Dark Mode interface with glassmorphism effect, optimized for workshop environments (UI in Polish).
- **Security**: Works locally, no uploading your designs to external servers.

## 🚀 Getting Started

The application is cross-platform (Windows & Linux).

### Downloading (Binary Version)
Find the latest `.exe` (Windows) or `.AppImage` (Linux) in the [Releases](https://github.com/YourName/svg_to_gcode/releases) tab.

### Local Development
1. Install [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/).
2. Clone the repository.
3. Install dependencies: `npm install`.
4. Run the app: `npm run tauri dev`.

## 🛠️ Technical Stack

- **Framework**: [Tauri](https://tauri.app/) (Rust security and performance)
- **Frontend**: React + TypeScript + Vite
- **Geometry**: [clipper-lib](http://www.angusj.com/delphi/clipper.php) for advanced offset calculations.

## 📄 License

Project released under the MIT License. See [LICENSE](LICENSE) for details.
