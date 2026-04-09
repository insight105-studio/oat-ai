use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use once_cell::sync::Lazy;
use std::time::Duration;
use std::path::PathBuf;

struct AppState {
    recording: AtomicBool,
    audio_path: Mutex<Option<String>>,
    recording_mode: Mutex<String>, // "microphone" or "system"
}

static STATE: Lazy<AppState> = Lazy::new(|| AppState {
    recording: AtomicBool::new(false),
    audio_path: Mutex::new(None),
    recording_mode: Mutex::new("microphone".to_string()),
});

#[tauri::command]
fn set_recording_mode(mode: String) -> Result<String, String> {
    let valid_modes = ["microphone", "system"];
    if !valid_modes.contains(&mode.as_str()) {
        return Err(format!("Invalid mode. Valid modes: {:?}", valid_modes));
    }
    
    *STATE.recording_mode.lock().unwrap() = mode.clone();
    Ok(format!("Recording mode set to: {}", mode))
}

#[tauri::command]
fn get_recording_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host.devices().map_err(|e| format!("Failed to get devices: {}", e))?;
    
    let mut device_names = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            device_names.push(name);
        }
    }
    
    Ok(device_names)
}

#[tauri::command]
fn start_recording() -> Result<String, String> {
    if STATE.recording.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    let host = cpal::default_host();
    let mode = STATE.recording_mode.lock().unwrap().clone();
    
    // Log available devices for debugging
    if let Ok(devices) = host.devices() {
        for device in devices {
            if let Ok(name) = device.name() {
                eprintln!("[oats] Available device: {}", name);
            }
        }
    }
    
    let (device, use_output_config) = match mode.as_str() {
        "microphone" => {
            let dev = host.default_input_device()
                .ok_or_else(|| "No input device found".to_string())?;
            eprintln!("[oats] Using microphone: {:?}", dev.name());
            (dev, false)
        }
        "system" => {
            // On Windows, use the default output device for loopback capture.
            // cpal on WASAPI supports capturing from output devices (loopback).
            // First try to find a dedicated loopback/stereo-mix device
            let devices = host.devices().map_err(|e| format!("Failed to get devices: {}", e))?;
            let mut system_device = None;
            
            for device in devices {
                if let Ok(name) = device.name() {
                    let name_lower = name.to_lowercase();
                    if name_lower.contains("stereo mix") || 
                       name_lower.contains("what u hear") || 
                       name_lower.contains("loopback") ||
                       name_lower.contains("system audio") {
                        eprintln!("[oats] Found system audio device: {}", name);
                        system_device = Some((device, false));
                        break;
                    }
                }
            }
            
            // If no dedicated device found, use the default output device for loopback
            if system_device.is_none() {
                if let Some(output_dev) = host.default_output_device() {
                    eprintln!("[oats] Using output device for loopback: {:?}", output_dev.name());
                    system_device = Some((output_dev, true));
                }
            }
            
            let (dev, is_output) = system_device.ok_or_else(|| {
                "No system audio device found. Tidak dapat menemukan perangkat audio sistem.\n\
                Pastikan speaker/headphone terhubung.".to_string()
            })?;
            (dev, is_output)
        }
        _ => return Err("Invalid recording mode".to_string()),
    };
    
    let config = if use_output_config {
        // For loopback capture from output device, use output config
        device.default_output_config()
            .map_err(|e| format!("Could not get output config for loopback: {}", e))?
    } else {
        device.default_input_config()
            .map_err(|e| format!("Could not get default input config: {}", e))?
    };

    STATE.recording.store(true, Ordering::SeqCst);
    
    // Store in system temp dir to prevent Tauri dev watcher from restarting
    let mut temp_path = std::env::temp_dir();
    temp_path.push("oats_recording.wav");
    let temp_file = temp_path.to_string_lossy().to_string();
    
    *STATE.audio_path.lock().unwrap() = Some(temp_file.clone());

    let temp_file_clone = temp_file.clone();
    std::thread::spawn(move || {
        let spec = WavSpec {
            channels: config.channels() as u16,
            sample_rate: config.sample_rate().0,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        
        let writer_res = WavWriter::create(&temp_file_clone, spec);
        if let Err(e) = writer_res {
            eprintln!("Failed to create wav writer: {}", e);
            STATE.recording.store(false, Ordering::SeqCst);
            return;
        }
        
        let writer = Arc::new(Mutex::new(Some(writer_res.unwrap())));
        let writer_clone = writer.clone();
        let err_fn = move |err| eprintln!("an error occurred on stream: {}", err);
        
        let stream_res = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &_| {
                        if let Some(ref mut w) = *writer_clone.lock().unwrap() {
                            for &sample in data {
                                let s = (sample * i16::MAX as f32) as i16;
                                w.write_sample(s).ok();
                            }
                        }
                    },
                    err_fn,
                    None
                )
            }
            cpal::SampleFormat::I16 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &_| {
                        if let Some(ref mut w) = *writer_clone.lock().unwrap() {
                            for &sample in data {
                                w.write_sample(sample).ok();
                            }
                        }
                    },
                    err_fn,
                    None
                )
            }
            _ => {
                eprintln!("Unsupported sample format");
                STATE.recording.store(false, Ordering::SeqCst);
                return;
            }
        };

        if let Ok(stream) = stream_res {
            if let Err(e) = stream.play() {
                eprintln!("Failed to play stream: {}", e);
                STATE.recording.store(false, Ordering::SeqCst);
                return;
            }

            while STATE.recording.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(100));
            }
            drop(stream);
        } else if let Err(e) = stream_res {
            eprintln!("Failed to build input stream: {}", e);
            STATE.recording.store(false, Ordering::SeqCst);
        }

        {
            let mut w_lock = writer.lock().unwrap();
            if let Some(w) = w_lock.take() {
                w.finalize().ok();
            }
        }
    });

    Ok("Recording started".to_string())
}

#[tauri::command]
async fn stop_recording() -> Result<String, String> {
    if !STATE.recording.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }

    STATE.recording.store(false, Ordering::SeqCst);
    
    // Give time to finalize wav file
    tokio::time::sleep(Duration::from_millis(600)).await;

    let path = {
        let path_lock = STATE.audio_path.lock().unwrap();
        path_lock.as_ref().ok_or("No recording found")?.clone()
    };

    // Wrap the heavy CPU work in spawn_blocking to keep the async executor responsive
    let transcription_res = tokio::task::spawn_blocking(move || {
        // 1. Read the wav file and convert to f32
        let mut reader = hound::WavReader::open(&path)
            .map_err(|e| format!("Failed to open wav file: {}", e))?;
        
        let spec = reader.spec();
        eprintln!("[oats] WAV spec: channels={}, sample_rate={}, bits={}", 
            spec.channels, spec.sample_rate, spec.bits_per_sample);
        
        let samples: Vec<f32> = reader.samples::<i16>()
            .map(|s| s.unwrap_or(0) as f32 / i16::MAX as f32)
            .collect();

        eprintln!("[oats] Total samples read: {} ({:.1}s at {}Hz)",
            samples.len(),
            samples.len() as f64 / spec.sample_rate as f64 / spec.channels as f64,
            spec.sample_rate);

        // Check if audio is essentially silence
        let max_amplitude = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        eprintln!("[oats] Audio stats: max_amplitude={:.4}, rms={:.6}", max_amplitude, rms);

        if samples.len() < spec.sample_rate as usize {
            return Ok(format!("Audio terlalu pendek ({:.1} detik). Rekam lebih lama untuk hasil transkripsi yang baik.",
                samples.len() as f64 / spec.sample_rate as f64 / spec.channels as f64));
        }

        if rms < 0.0001 {
            return Ok("Audio yang direkam adalah keheningan total (silence).\n\n\
                Kemungkinan penyebab:\n\
                • Mode rekaman salah — gunakan 'System' untuk merekam suara YouTube/Teams\n\
                • Volume sumber audio terlalu kecil\n\
                • Perangkat audio tidak terhubung dengan benar\n\
                • Pada mode System, pastikan audio sedang diputar saat merekam".to_string());
        }

        if rms < 0.005 {
            eprintln!("[oats] WARNING: Audio very quiet (rms={:.6}), will normalize before transcription", rms);
        }

        // 2. Load Whisper model — resolve absolute path
        let model_path = find_whisper_model();
        
        if model_path.is_none() {
            return Ok(format!("[Model tidak ditemukan]\n\n\
                Audio berhasil direkam ({} samples, {:.1}s, {}Hz, {} channel(s)).\n\n\
                Tapi file model Whisper (ggml-base.bin) tidak ditemukan.\n\
                Letakkan file di folder src-tauri.",
                samples.len(), 
                samples.len() as f64 / spec.sample_rate as f64 / spec.channels as f64,
                spec.sample_rate, spec.channels));
        }
        let model_path = model_path.unwrap();

        use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

        eprintln!("[oats] Loading Whisper model from: {}", model_path);
        let ctx = WhisperContext::new_with_params(&model_path, WhisperContextParameters::default())
            .map_err(|e| format!("Failed to load model: {}", e))?;
        let mut state = ctx.create_state()
            .map_err(|e| format!("Failed to create state: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
        // Explicitly set language to Indonesian (or auto if preferred, but "id" works much better for Indonesian audio)
        params.set_detect_language(false);
        params.set_language(Some("id"));
        params.set_translate(false);
        params.set_no_context(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        let mono_samples: Vec<f32> = if spec.channels == 2 {
            samples.chunks(2).map(|c| if c.len() > 1 { (c[0] + c[1]) / 2.0 } else { c[0] }).collect()
        } else {
            samples
        };

        let target_sample_rate = 16000.0;
        let original_sample_rate = spec.sample_rate as f32;
        let resampled_audio = if original_sample_rate != target_sample_rate {
            let ratio = original_sample_rate / target_sample_rate;
            let target_len = (mono_samples.len() as f32 / ratio) as usize;
            let mut result = Vec::with_capacity(target_len);
            
            // Perbaikan Resampling: Menggunakan rata-rata (Moving Average) untuk menghaluskan audio 
            // agar tidak terjadi efek aliasing/suara robotik yang membuat Whisper gagal mendeteksi
            for i in 0..target_len {
                let start_idx = (i as f32 * ratio) as usize;
                let end_idx = ((i + 1) as f32 * ratio) as usize;
                let end_idx = end_idx.min(mono_samples.len());
                
                let mut sum = 0.0;
                let mut count = 0;
                for j in start_idx..end_idx {
                    sum += mono_samples[j];
                    count += 1;
                }
                
                if count > 0 {
                    result.push(sum / count as f32);
                } else if start_idx < mono_samples.len() {
                    result.push(mono_samples[start_idx]);
                }
            }
            eprintln!("[oats] Resampled from {}Hz to {}Hz: {} -> {} samples",
                original_sample_rate, target_sample_rate, mono_samples.len(), result.len());
            result
        } else {
            mono_samples
        };

        // Normalize audio to boost quiet recordings
        let peak = resampled_audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let normalized_audio = if peak > 0.0 && peak < 0.5 {
            let gain = 0.9 / peak; // Normalize to 90% peak
            eprintln!("[oats] Audio is quiet (peak={:.4}), applying gain of {:.1}x", peak, gain);
            resampled_audio.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect::<Vec<f32>>()
        } else {
            eprintln!("[oats] Audio peak: {:.4} (no normalization needed)", peak);
            resampled_audio
        };

        eprintln!("[oats] Running Whisper transcription on {} samples ({:.1}s)...",
            normalized_audio.len(), normalized_audio.len() as f64 / 16000.0);

        state.full(params, &normalized_audio)
            .map_err(|e| format!("Failed to run transcription: {}", e))?;

        let num_segments = state.full_n_segments()
            .map_err(|e| format!("Failed to get segment count: {}", e))?;

        eprintln!("[oats] Transcription complete: {} segments", num_segments);

        let mut transcript = String::new();
        for i in 0..num_segments {
            let segment = state.full_get_segment_text(i)
                .map_err(|e| format!("Failed to get segment text: {}", e))?;
            eprintln!("[oats] Segment {}: {}", i, segment.trim());
            if !segment.trim().is_empty() {
                transcript.push_str(&segment);
                transcript.push('\n');
            }
        }

        if transcript.trim().is_empty() {
            return Ok("Whisper tidak mendeteksi percakapan dalam audio.\n\nAudio berhasil direkam tetapi tidak mengandung suara yang dapat dikenali.\nPastikan sumber audio memiliki percakapan/dialog yang jelas.".to_string());
        }

        eprintln!("[oats] Final transcript length: {} chars", transcript.len());
        Ok::<String, String>(transcript)
    }).await.map_err(|e| format!("Task joined failed: {}", e))?;


    transcription_res
}

/// Find the Whisper model file in various possible locations
fn find_whisper_model() -> Option<String> {
    let candidates = vec![
        // 1. Next to the executable
        std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("ggml-base.bin"))),
        // 2. In src-tauri (for dev mode)
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ggml-base.bin")),
        // 3. Relative to current working directory
        Some(PathBuf::from("ggml-base.bin")),
        // 4. In the app data directory
        dirs_next().map(|d| d.join("oats-ai").join("ggml-base.bin")),
    ];
    
    for candidate in candidates.into_iter().flatten() {
        eprintln!("[oats] Checking model path: {}", candidate.display());
        if candidate.exists() {
            eprintln!("[oats] Found model at: {}", candidate.display());
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    
    eprintln!("[oats] No Whisper model found!");
    None
}

fn dirs_next() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local").join("share"))
    }
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_recording, stop_recording, set_recording_mode, get_recording_devices])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
