# Oats AI - Desktop App

Oats AI is a privacy-first desktop application for recording, transcribing, and summarizing meetings utilizing local offline systems and cutting-edge free AI APIs.

## 🚀 Getting Started

1. Install module dependencies:
   ```bash
   npm install
   ```
2. Run the Tauri development server:
   ```bash
   npm run tauri dev
   ```

## 📦 Build & Publish Aplikasi

Untuk menghasilkan *installer* (*build release*) seperti `.exe` / `.app` / `.deb` yang siap didistribusikan ke *user*, Anda hanya perlu melakukan *building* dengan 1 perintah berikut di terminal:

```bash
npm run tauri build
```

> **Catatan:** Waktu *build* untuk pertama kalinya akan memakan waktu cukup lama karena aplikasi perlu meng-_compile_ keseluruhan kode _back-end_ (Rust). Hasil akhir berupa file instalasi (`.exe` dll) akan digenerate secara otomatis ke dalam folder `src-tauri/target/release/bundle/`.

---

## ⚙️ Konfigurasi AI Summary (OpenRouter)

Oats AI dilengkapi dengan fitur peringkasan teks lanjutan yang ditenagai oleh LLM via OpenRouter. Untuk menggunakan fitur `✦ Ringkas`, Anda harus memasukkan API Key ke dalam sistem aplikasi.

### Cara Mendapatkan API Key (Gratis 100%):

1. Buka web [OpenRouter.ai](https://openrouter.ai/) lalu buat akun (bisa Sign up langsung via Google atau GitHub).
2. Setelah berhasil login, masuk ke dashboard bagian **[Keys](https://openrouter.ai/settings/keys)**.
3. Klik tombol **"Create Key"** (Beri nama sesuka Anda, contoh: `Oats AI Local`).
4. Salin kode API Key yang muncul (Dimulai dengan `sk-or-v1-...`). *Simpan dengan baik karena kode ini hanya akan ditampilkan sekali.*
5. Aplikasi ini menggunakan model *free-tier* OpenRouter yang disediakan gratis, sehingga Anda tidak perlu memasukkan kartu kredit atau saldo apa pun!

### Cara Memasang API Key ke Aplikasi:

1. Buat file baru dengan nama `.env` di direktori proyek ini (`oats-app/.env`).
2. Masukkan baris berikut di dalam file `.env` tersebut, dan ganti `KODE_API_ANDA_DISINI` dengan kode rahasia yang tadi disalin:

```env
VITE_OPENROUTER_API_KEY=KODE_API_ANDA_DISINI
```

3. Simpan file tersebut.
4. **Wajib:** Jika terminal (*dev server*) Anda sebelumnya sedang berjalan, matikan terlebih dahulu dengan menekan tombol `Ctrl + C` di terminal, lalu jalankan perintah `npm run tauri dev` kembali. Vite hanya membaca file `.env` saat awal *startup*!

> **✨ Fitur Algoritma Fallback:**
> Jika API *free-tier* OpenRouter sedang lambat atau menolak request karena penuh (*server overloaded*), Oats AI secara otomatis akan melindungi catatan rapat Anda, dengan beralih menggunakan Algoritma Ringkasan Lokal. Peringkasan sekunder ini berjalan 100% di komputer Anda tanpa kuota internet sedikitpun.
