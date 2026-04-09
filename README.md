# Oats AI - Desktop App
> "The Nutritious Note-taker: Essential, Light, and Local."

Oats AI is a privacy-first desktop application for recording, transcribing, and summarizing meetings utilizing local offline systems and cutting-edge free AI APIs.

---

## 💡 Why "Oats"?
- **Light & Nutrient-Dense:** Like oats, this app is small in size but delivers highly valuable results (information nutrition).
- **Simple:** No distracting fancy features, just pure functionality following a "Zen-Minimalist" design philosophy.
- **Local:** Cooked (processed) entirely in your own home (on-device).

## 🏗️ Architecture & Features

Oats AI is designed to run in strict corporate environments without requiring administrator privileges for installation.
- **Self-Contained & Portable:** Distributed as a single binary file (`.exe` on Windows or `.app` on macOS).
- **No-Admin Required:** Runs entirely in User-space. Does not write to `C:\Program Files`.
- **Local Intelligence:** Uses `whisper.cpp` (via `whisper-rs`) to perform 100% on-device transcription without relying on the cloud.
- **Portable Storage:** Local SQLite database and AI Models (`.bin` files) are stored securely relative to the application folder.
- **System Audio Capture:** Captures participant audio directly using WASAPI Loopback (Windows) or ScreenCaptureKit (macOS) without extra drivers.

## ✨ The Oats Experience (UI/UX)
- **The Porridge Bowl (Main Editor):** A clean canvas for typing manual notes during the meeting.
- **Ghost Transcript:** A transparent, toggleable transcript panel on the right side.
- **The Grain Pulse:** A subtle indicator that softly pulses when audio is detected.
- **Action Drawer:** A bottom panel that automatically appears post-meeting, displaying generated To-Do lists.

## 💻 Hardware Requirements

Because Oats AI runs AI models locally, the following specifications are required:

| Component | Minimum Specification | Recommended |
| :--- | :--- | :--- |
| **CPU** | Intel i5 / Ryzen 5 (4 Cores) | Apple M-Series or Intel i7 (8 Cores) |
| **RAM** | 8 GB | 16 GB |
| **GPU** | Integrated | Dedicated (NVIDIA/Metal) for acceleration |
| **OS** | Windows 10/11 or macOS 12+ | Latest OS with updated WebView2 |

---

## 🛠️ Developer Stack

- **Backend:** Rust Stable (via `cargo`)
- **Frontend:** React.js / Next.js with Tailwind CSS
- **Bridge:** Tauri Framework (v2 recommended)
- **Compiler:** MSVC Build Tools (`+crt-static`) for Windows, Xcode Command Line Tools for macOS
- **AI Engine:** `whisper-rs` (Rust bindings for `whisper.cpp`)

## 🚀 Getting Started

1. Install module dependencies:
   ```bash
   npm install
   ```
2. Run the Tauri development server:
   ```bash
   npm run tauri dev
   ```

## 📦 Build & Publish Application

To generate installers (release builds) such as `.exe` / `.app` / `.deb` ready for user distribution, you only need to build them using a single terminal command:

```bash
npm run tauri build
```

> **Note:** The initial build process will take quite some time as the application needs to compile the entire back-end code (Rust). The final installation files (`.exe` etc.) will be automatically generated inside the `src-tauri/target/release/bundle/` folder.

---

## ⚙️ AI Summary Configuration (OpenRouter)

Oats AI is equipped with an advanced text summarization feature powered by LLMs via OpenRouter. To use the `✦ Summarize` feature, you must enter an API Key into the application system.

### How to Get an API Key (100% Free):

1. Go to the [OpenRouter.ai](https://openrouter.ai/) website and create an account (you can sign up directly via Google or GitHub).
2. Once logged in, go to the **[Keys](https://openrouter.ai/settings/keys)** section in your dashboard.
3. Click the **"Create Key"** button (Name it whatever you like, e.g., `Oats AI Local`).
4. Copy the generated API Key (Starts with `sk-or-v1-...`). *Keep it safe as this code will only be shown once.*
5. This application uses the free-tier OpenRouter models provided for free, so you do not need to enter a credit card or add any balance!

### How to Install the API Key into the Application:

1. Create a new file named `.env` in this project directory (`oats-app/.env`).
2. Insert the following line inside the `.env` file, and replace `YOUR_API_CODE_HERE` with the secret code you copied earlier:

```env
VITE_OPENROUTER_API_KEY=YOUR_API_CODE_HERE
```

3. Save the file.
4. **Mandatory:** If your terminal (dev server) is currently running, stop it first by pressing `Ctrl + C` in the terminal, then run the `npm run tauri dev` command again. Vite only reads the `.env` file during the initial startup!

> **✨ Fallback Algorithm Feature:**
> If the OpenRouter free-tier API is slow or rejects requests due to being overloaded, Oats AI will automatically protect your meeting notes by switching to the Local Summary Algorithm. This secondary summarization runs 100% on your computer without using any internet quota.
