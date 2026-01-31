# Build Guide

## Windows

To build and run the application on Windows, you need the following tools:

### 1. Prerequisites

1.  **Microsoft Visual Studio C++ Build Tools**:
    *   Download the installer from [Microsoft](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
    *   During installation, select: **"Desktop development with C++"**.
2.  **WebView2**:
    *   Usually pre-installed on Windows 10 and 11. If not, download and install [WebView2 Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
3.  **Rust**:
    *   Download and run `rustup-init.exe` from [rust-lang.org](https://www.rust-lang.org/tools/install).
    *   Follow the terminal instructions (default installation is usually OK).
4.  **Node.js**:
    *   Download and install the LTS version from [nodejs.org](https://nodejs.org/).

### 2. Getting the Project

Copy the project folder to your Windows machine or clone it from the Git repository.

### 3. Installation and Running

Open a terminal (PowerShell or CMD) in the project folder and run:

```powershell
# Install JavaScript dependencies
npm install

# Run in development mode (hot-reload)
npm run tauri dev
```

### 4. Building Production Version (.exe)

To create a standalone `.exe` (and .msi installer), run:

```powershell
npm run tauri build
```

The resulting files can be found in:
`src-tauri/target/release/bundle/msi/` (installer)
or
`src-tauri/target/release/` (.exe file)

---

## Alternative: GitHub Actions (Cross-compilation)

If you don't have a Windows machine, you can use **GitHub Actions** to automatically build the Windows version on every push.

The configuration is already provided in `.github/workflows/release.yml`.
