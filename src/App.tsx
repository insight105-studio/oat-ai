import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Meeting {
  id: number;
  title: string;
  date: string;
  content: string;
  transcript: string;
  summary: string;
  todos: TodoItem[];
}

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface TranscriptLine {
  timestamp: string;
  text: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatDateShort(dateStr: string): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  
  if (dateStr.startsWith(today)) {
    return `Today, ${dateStr.slice(11, 16)}`;
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  if (dateStr.startsWith(yStr)) {
    return `Yesterday, ${dateStr.slice(11, 16)}`;
  }
  
  return dateStr.slice(0, 10);
}

function App() {
  // === Meeting State ===
  const [meetings, setMeetings] = useState<Meeting[]>(() => {
    const now = new Date();
    return [
      {
        id: 1,
        title: `meeting-${formatDate(now)}`,
        date: now.toISOString().slice(0, 19).replace("T", " "),
        content: "",
        transcript: "",
        summary: "",
        todos: [],
      },
    ];
  });
  const [activeMeetingId, setActiveMeetingId] = useState(1);

  // === Recording State ===
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [statusText, setStatusText] = useState("Ready — Oats AI active");
  const [recordingMode, setRecordingMode] = useState("microphone");
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // === Transcript Panel ===
  const [txVisible, setTxVisible] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptLine[]>([]);
  const txBodyRef = useRef<HTMLDivElement>(null);

  // === AI Summary / Drawer ===
  const [showDrawer, setShowDrawer] = useState(false);
  const [showAiBtn, setShowAiBtn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // === Error Toast ===
  const [error, setError] = useState<string | null>(null);

  // === Rename State ===
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Get active meeting
  const activeMeeting = meetings.find((m) => m.id === activeMeetingId);

  // === Update active meeting field ===
  const updateMeeting = useCallback(
    (field: keyof Meeting, value: unknown) => {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === activeMeetingId ? { ...m, [field]: value } : m
        )
      );
    },
    [activeMeetingId]
  );

  // === New Meeting ===
  const newMeeting = () => {
    if (isRecording) return; // prevent while recording
    const now = new Date();
    const newId = Date.now();
    const meeting: Meeting = {
      id: newId,
      title: `meeting-${formatDate(now)}`,
      date: now.toISOString().slice(0, 19).replace("T", " "),
      content: "",
      transcript: "",
      summary: "",
      todos: [],
    };
    setMeetings((prev) => [meeting, ...prev]);
    setActiveMeetingId(newId);
    setShowDrawer(false);
    setShowAiBtn(false);
    setLiveTranscript([]);
    setStatusText("Ready — Oats AI active");
  };

  // === Select Meeting ===
  const selectMeeting = (id: number) => {
    if (isRecording) return;
    if (renamingId) return; // don't switch while renaming
    setActiveMeetingId(id);
    const meeting = meetings.find((m) => m.id === id);
    if (meeting && meeting.todos.length > 0) {
      setShowDrawer(true);
    } else {
      setShowDrawer(false);
    }
    setShowAiBtn(!!meeting?.transcript);
    setLiveTranscript([]);
  };

  // === Delete Meeting ===
  const deleteMeeting = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (isRecording) return;
    if (meetings.length <= 1) {
      setError("Cannot delete the last meeting");
      setTimeout(() => setError(null), 3000);
      return;
    }
    setMeetings((prev) => {
      const filtered = prev.filter((m) => m.id !== id);
      if (id === activeMeetingId && filtered.length > 0) {
        setActiveMeetingId(filtered[0].id);
      }
      return filtered;
    });
  };

  // === Start Rename ===
  const startRename = (e: React.MouseEvent, meeting: Meeting) => {
    e.stopPropagation();
    if (isRecording) return;
    setRenamingId(meeting.id);
    setRenameValue(meeting.title);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  };

  // === Confirm Rename ===
  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === renamingId ? { ...m, title: renameValue.trim() } : m
        )
      );
    }
    setRenamingId(null);
    setRenameValue("");
  };

  // === Cancel Rename ===
  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  // === Toggle Transcript Panel ===
  const toggleTranscript = () => {
    setTxVisible((prev) => !prev);
  };

  // === Recording Mode ===
  const changeRecordingMode = async (mode: string) => {
    try {
      await invoke("set_recording_mode", { mode });
      setRecordingMode(mode);
    } catch (err) {
      console.error("Failed to set recording mode:", err);
      setError(String(err));
      setTimeout(() => setError(null), 4000);
    }
  };

  // === Start Recording ===
  const startRecording = async () => {
    try {
      await invoke("start_recording");
      setIsRecording(true);
      setRecordingTime(0);
      setShowAiBtn(false);
      setShowDrawer(false);
      setLiveTranscript([]);
      setStatusText("Recording — 00:00 · Whisper active");

      // Start timer
      recTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;
          setStatusText(
            `Recording — ${pad(Math.floor(next / 60))}:${pad(next % 60)} · Whisper active`
          );
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError(String(err));
      setTimeout(() => setError(null), 5000);
    }
  };

  // === Filter Whisper hallucinations ===
  const cleanTranscript = (raw: string): string => {
    // Whisper often hallucinates on silence/noise with repeated patterns
    const lines = raw.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    // Remove common Whisper hallucination patterns
    const hallucinations = [
      /^\[.*\]$/,              // [MUSIC], [BLANK_AUDIO], etc.
      /^\(.*\)$/,              // (music), (silence), etc.
      /^♪.*$/,                 // Musical notes
      /^\*.*\*$/,              // *music*, *silence*
      /^thanks? for watching/i,
      /^please subscribe/i,
      /^like and subscribe/i,
      /^terima kasih.*menonton/i,
      /^jangan lupa.*subscribe/i,
    ];
    
    const cleaned = lines.filter(line => {
      // Remove hallucination patterns
      if (hallucinations.some(h => h.test(line))) return false;
      // Remove very short repetitive lines (< 3 chars)
      if (line.replace(/[^a-zA-Z0-9]/g, '').length < 2) return false;
      return true;
    });
    
    // Detect repetition: if a line appears >3 times, it's hallucination
    const freq: Record<string, number> = {};
    cleaned.forEach(l => { freq[l.toLowerCase()] = (freq[l.toLowerCase()] || 0) + 1; });
    const deduped = cleaned.filter(l => freq[l.toLowerCase()] <= 3);
    
    return deduped.join('\n');
  };

  // === Stop Recording ===
  const stopRecording = async () => {
    setIsRecording(false);
    setIsProcessing(true);

    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }

    const finalTime = recordingTime;
    setStatusText(
      `Done — ${pad(Math.floor(finalTime / 60))}:${pad(finalTime % 60)} recorded · Transcribing...`
    );

    try {
      const rawResult: string = await invoke("stop_recording");
      
      // Clean the transcript from Whisper hallucinations
      const result = cleanTranscript(rawResult);

      if (!result.trim()) {
        setStatusText("Done — No audio detected");
        setError("No audio detected. Ensure your audio source is active and the correct recording mode is selected.");
        setTimeout(() => setError(null), 6000);
        setIsProcessing(false);
        return;
      }

      // Parse transcript result into lines
      const lines = result
        .split("\n")
        .filter((l) => l.trim())
        .map((text, idx) => ({
          timestamp: `${pad(Math.floor((idx * 12) / 60))}:${pad((idx * 12) % 60)}`,
          text: text.trim(),
        }));

      setLiveTranscript(lines);
      setTxVisible(true); // Auto-open transcript panel
      updateMeeting("transcript", result);

      setStatusText("Generating AI summary via OpenRouter...");

      // Generate summary via OpenRouter API
      const currentContent = (activeMeeting?.content || "").trim();
      const summaryResult = await generateSummaryWithAI(result, currentContent);
      updateMeeting("summary", summaryResult);

      // AUTO-INSERT summary into editor content
      const autoContent = currentContent
        ? `${currentContent}\n\n${'═'.repeat(40)}\n${summaryResult}`
        : summaryResult;
      updateMeeting("content", autoContent);

      // Show AI button and drawer with action items
      setShowAiBtn(true);

      // Extract action items from AI summary
      const actionItems = extractActionItems(summaryResult);
      if (actionItems.length > 0) {
        updateMeeting("todos", actionItems);
      }

      // After a short delay, show drawer
      setTimeout(() => {
        setShowDrawer(true);
        setStatusText(
          `✓ AI Summary completed — ${lines.length} segments, ${result.split(/\s+/).length} words`
        );
      }, 800);
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setError(String(err));
      setTimeout(() => setError(null), 5000);
      setStatusText("Error — Failed to transcribe audio");
    } finally {
      setIsProcessing(false);
    }
  };

  // === Toggle Recording ===
  const toggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // === Local Summary Generation (Term Frequency Heuristic) ===
  const generateLocalSummary = (transcript: string, durationSecs?: number): string => {
    if (!transcript.trim()) return "No transcript to summarize.";

    const stopWords = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 
      'dengan', 'adalah', 'pada', 'the', 'and', 'is', 'it', 'to', 'of', 'in', 'a', 'an',
      'that', 'this', 'was', 'are', 'be', 'has', 'have', 'had', 'not', 'but', 'or', 'as',
      'we', 'you', 'they', 'i', 'he', 'she', 'my', 'your', 'our', 'so', 'if', 'can',
      'will', 'do', 'more', 'very', 'just', 'also', 'then', 'than', 'its', 'been',
      'ada', 'juga', 'kita', 'bisa', 'akan', 'sudah', 'saya', 'kami', 'mereka', 'dia',
      'bukan', 'tidak', 'mau', 'lagi', 'jadi', 'kalau', 'tapi', 'sama', 'ya',
      'seperti', 'karena', 'apa', 'bagaimana', 'sebuah', 'satu', 'dua', 'kan', 'nya',
      'terus', 'nanti', 'gitu', 'sih', 'dong', 'kok', 'nah', 'pas', 'kayak', 'udah',
      'belum', 'buat', 'oke', 'yaudah', 'iya', 'enggak', 'banyak', 'mungkin',
      'masih', 'cuma', 'biar', 'aja', 'aku', 'kamu', 'ya', 'hmm', 'mhmm', 'eh', 'oh',
      'berarti', 'kalo', 'buat', 'atau', 'begitu', 'begini', 'pun', 'lalu', 'aja'
    ]);

    // Better Sentence splitting: considering newlines and common punctuations
    const rawSentences = transcript.split(/[.!?\n]+/);
    const sentences = rawSentences.map(s => s.trim()).filter(s => s.length > 15);
    const words = transcript.split(/[\s.!?,\n]+/).filter(w => w.trim().length > 0);
    const wordCount = words.length;
    
    // Calculate global word frequencies (TF)
    const wordFreq: Record<string, number> = {};
    words.forEach(w => {
        const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (lower.length > 2 && !stopWords.has(lower)) {
            wordFreq[lower] = (wordFreq[lower] || 0) + 1;
        }
    });

    // Score sentences based on word frequencies
    const scoredSentences = sentences.map((sentence, index) => {
        const sentenceWords = sentence.split(/\s+/);
        let score = 0;
        sentenceWords.forEach(w => {
            const lower = w.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (wordFreq[lower]) {
                score += wordFreq[lower];
            }
        });
        // Normalize by length so we don't unfairly favor run-on sentences, but give a small boost to length
        const normalizedScore = score / Math.max(1, Math.sqrt(sentenceWords.length));
        return { text: sentence, score: normalizedScore, originalIndex: index };
    });

    // Pick top sentences for summary (e.g., top 15% or max 7 sentences)
    const numSummarySentences = Math.max(3, Math.min(8, Math.ceil(sentences.length * 0.20)));
    
    // Sort by score descending to get the most relevant ones, then sort by originalIndex to maintain flow
    const topSentences = scoredSentences
        .sort((a, b) => b.score - a.score)
        .slice(0, numSummarySentences)
        .sort((a, b) => a.originalIndex - b.originalIndex);

    const title = activeMeeting?.title || "Meeting";
    const now = new Date();
    const dateStr = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
    const durationStr = durationSecs 
        ? `${Math.floor(durationSecs / 60)} menit ${durationSecs % 60} detik`
        : "N/A";

    const engCount = words.filter(w => ['the', 'is', 'and', 'to', 'of', 'it', 'in', 'that'].includes(w.toLowerCase())).length;
    const idCount = words.filter(w => ['dan', 'yang', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk'].includes(w.toLowerCase())).length;
    const isEng = engCount > idCount;

    let summary = '';
    summary += isEng ? `📋 MEETING SUMMARY\n` : `📋 RINGKASAN MEETING\n`;
    summary += `───────────────────────────────────\n`;
    summary += isEng ? `📌 Title: ${title}\n` : `📌 Judul: ${title}\n`;
    summary += isEng ? `📅 Date: ${dateStr}\n` : `📅 Tanggal: ${dateStr}\n`;
    summary += isEng ? `⏱️ Duration: ${durationStr}\n` : `⏱️ Durasi: ${durationStr}\n`;
    summary += isEng ? `📊 Total: ${wordCount} words, ${sentences.length} sentences detected\n` : `📊 Total: ${wordCount} kata, ${sentences.length} kalimat terdeteksi\n`;
    summary += `\n`;

    if (topSentences.length > 0) {
        summary += isEng ? `📝 KEY TRANSCRIPT HIGHLIGHTS\n` : `📝 POIN-POIN PENTING TRANKSKRIP\n`;
        summary += `───────────────────────────────────\n`;
        topSentences.forEach((s, i) => {
            // Clean up the text slightly
            let cleanText = s.text.replace(/^[-\s]+/, '').trim();
            // Capitalize first letter
            if(cleanText) {
                cleanText = cleanText.charAt(0).toUpperCase() + cleanText.slice(1);
            }
            summary += `  ${i + 1}. ${cleanText}\n`;
        });
        
        const missingCount = sentences.length - topSentences.length;
        if (missingCount > 0) {
            summary += isEng 
              ? `\n  ... and ${missingCount} other interesting sentence references in the transcript.\n`
              : `\n  ... dan ${missingCount} referensi kalimat menarik lainnya di dalam transkrip.\n`;
        }
    }

    summary += `\n`;
    summary += isEng ? `🏷️ DETECTED TOPICS\n` : `🏷️ TOPIK TERDETEKSI\n`;
    summary += `───────────────────────────────────\n`;
    
    // Get top keywords based on the frequency map
    const topWords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
    
    if (topWords.length > 0) {
        summary += `  ${topWords.join(', ')}\n`;
    } else {
        summary += isEng 
          ? `  (not enough data to identify topics)\n`
          : `  (tidak cukup data untuk mengidentifikasi topik)\n`;
    }

    // Full transcript section
    summary += `\n`;
    summary += isEng ? `📜 FULL TRANSCRIPT\n` : `📜 TRANSKRIP LENGKAP\n`;
    summary += `───────────────────────────────────\n`;
    summary += transcript.trim() + '\n';

    return summary;
  };

  // === AI Summary via OpenRouter ===
  const generateSummaryWithAI = async (transcript: string, notes: string): Promise<string> => {
    if (!transcript.trim()) return "No transcript to summarize.";
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "google/gemma-3-27b-it:free",
          messages: [
            {
              role: "system",
              content: "Kamu adalah asisten AI dari Oats AI. Rapihkan transkrip rapat (dan gabungkan dengan catatan manual) menjadi ringkasan yang profesional sesuai dengan bahasa yang paling dominan digunakan di dalam transkrip. Gunakan format Markdown (bold, list, dll). WAJIB sertakan actionable items / To-Do list di bagian bawah jika ada, dengan format '- [ ] tugas di sini'."
            },
            {
              role: "user",
              content: `Buatkan ringkasan lengkap.\n\nCatatan Manual User:\n${notes}\n\nTranskrip Audio:\n${transcript}`
            }
          ]
        })
      });
      const data = await response.json();
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content;
      }
      if (data.error) {
        console.error("OpenRouter Error:", data.error);
        const fallback = generateLocalSummary(transcript);
        return `⚠️ Free AI API is overloaded/rejected. Falling back to Local Summary System...\n\n${fallback}`;
      }
      return `Terjadi error: Hasil AI kosong. Response data: ${JSON.stringify(data)}`;
    } catch (err) {
      console.error(err);
      const fallback = generateLocalSummary(transcript);
      return `⚠️ Failed to connect to OpenRouter API. Falling back to Local Summary System...\n\n${fallback}`;
    }
  };

  // === Extract Action Items (from AI output & transcript fallback) ===
  const extractActionItems = (text: string): TodoItem[] => {
    const items: TodoItem[] = [];
    const lines = text.split('\n');
    lines.forEach(line => {
      const cleanLine = line.trim();
      if (cleanLine.match(/^-\s*\[\s*\]\s+(.*)/i) || cleanLine.match(/^\d+\.\s*\[\s*\]\s+(.*)/i)) {
        const todoText = cleanLine.replace(/^[-1-9.]+\s*\[\s*\]\s+/i, '').replace(/\*/g, '').trim();
        if (todoText) items.push({ id: Date.now() + Math.random(), text: todoText, done: false });
      }
    });

    if (items.length > 0) return items.slice(0, 10);

    // Fallback naive extraction
    const keywords = ["harus", "perlu", "akan", "wajib", "follow up", "pastikan", "lakukan", "tugas"];
    const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 10);
    sentences.forEach((sentence) => {
      const lower = sentence.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        items.push({ id: Date.now() + Math.random(), text: sentence.replace(/\*/g, '').trim(), done: false });
      }
    });

    return items.slice(0, 10);
  };

  // === AI Refine (Re-generate summary) ===
  const aiRefine = async () => {
    if (!activeMeeting) return;
    if (!activeMeeting.transcript) {
      setError("No transcript available. Record a meeting first.");
      setTimeout(() => setError(null), 3000);
      return;
    }
    
    setIsProcessing(true);
    setStatusText("Refreshing AI summary via OpenRouter...");

    try {
      const currentContent = (activeMeeting.content || "").trim();
      const currentNotesOnly = currentContent.split(`\n\n${'═'.repeat(40)}\n`)[0] || currentContent;
      const summary = await generateSummaryWithAI(activeMeeting.transcript, currentNotesOnly);
      
      const autoContent = currentNotesOnly 
        ? `${currentNotesOnly}\n\n${'═'.repeat(40)}\n${summary}`
        : summary;
      
      updateMeeting("content", autoContent);
      updateMeeting("summary", summary);
      
      const newTodos = extractActionItems(summary);
      if (newTodos.length > 0) {
        updateMeeting("todos", newTodos);
        setShowDrawer(true);
      }
      
      setStatusText("✓ AI Summary refreshed");
    } catch (err) {
      setError("Failed to contact AI Server.");
      setTimeout(() => setError(null), 3000);
      setStatusText("Error — Summary failed");
    } finally {
      setIsProcessing(false);
    }
  };

  // === Toggle Todo ===
  const checkTodo = (todoId: number) => {
    if (!activeMeeting) return;
    const updatedTodos = activeMeeting.todos.map((t) =>
      t.id === todoId ? { ...t, done: !t.done } : t
    );
    updateMeeting("todos", updatedTodos);
  };

  // === Add Todo ===
  const addTodo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const input = e.target as HTMLInputElement;
      const val = input.value.trim();
      if (val && activeMeeting) {
        const newTodo: TodoItem = { id: Date.now(), text: val, done: false };
        updateMeeting("todos", [...activeMeeting.todos, newTodo]);
        input.value = "";
      }
    }
  };

  // Scroll transcript to bottom
  useEffect(() => {
    if (txBodyRef.current) {
      txBodyRef.current.scrollTop = txBodyRef.current.scrollHeight;
    }
  }, [liveTranscript]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, []);

  const doneCount = activeMeeting?.todos.filter((t) => t.done).length || 0;

  return (
    <div className="oats-frame">
      {/* Chrome Title Bar */}
      <div className="chrome">
        <div className="chrome-icon">🌾</div>
        <div className="chrome-label">Oats AI · Local & Private</div>
        <div style={{ width: 54 }} />
      </div>

      {/* Main Layout */}
      <div className="layout">
        {/* Sidebar */}
        <div className={`sidebar ${isRecording ? "dimmed" : ""}`}>
          <div className="sb-head">Meetings</div>
          <button className="sb-btn" onClick={newMeeting}>
            + New Meeting
          </button>
          <hr className="sb-divider" />
          <div className="meeting-list">
            {meetings.map((m) => (
              <div
                key={m.id}
                className={`mi ${m.id === activeMeetingId ? "active" : ""}`}
                onClick={() => selectMeeting(m.id)}
              >
                {renamingId === m.id ? (
                  <input
                    ref={renameInputRef}
                    className="rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={confirmRename}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="mi-title">{m.title}</div>
                    <div className="mi-meta">
                      <span className="mi-date">{formatDateShort(m.date)}</span>
                      <div className="mi-actions">
                        <button
                          className="mi-action-btn"
                          onClick={(e) => startRename(e, m)}
                          title="Rename"
                        >
                          ✎
                        </button>
                        <button
                          className="mi-action-btn mi-action-delete"
                          onClick={(e) => deleteMeeting(e, m.id)}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="main-area">
          {/* Toolbar */}
          <div className="toolbar">
            <input
              className="mtg-title-input"
              value={activeMeeting?.title || ""}
              onChange={(e) => updateMeeting("title", e.target.value)}
              placeholder="Meeting name..."
              title="Click to edit meeting title"
            />

            <select
              className="mode-select"
              value={recordingMode}
              onChange={(e) => changeRecordingMode(e.target.value)}
              title="Select audio source"
            >
              <option value="microphone">🎤 Mic</option>
              <option value="system">🔊 System</option>
            </select>

            <button
              className={`tbtn ${txVisible ? "" : "off"}`}
              onClick={toggleTranscript}
            >
              Live Transcript
            </button>

            {showAiBtn && (
              <button className="tbtn" onClick={aiRefine}>
                ✦ Summarize
              </button>
            )}

            <button
              className={`rec-btn ${isRecording ? "recording" : ""}`}
              onClick={toggleRecord}
              disabled={isProcessing}
            >
              <div className="rdot" />
              <span>{isRecording ? "Stop" : "Record"}</span>
            </button>
          </div>

          {/* Editor + Transcript */}
          <div className="editor-row">
            <textarea
              className="editor-area"
              placeholder={`Start taking notes here — calm and mindful...\n\nOats AI will merge your notes with the transcription once the meeting ends.`}
              value={activeMeeting?.content || ""}
              onChange={(e) => updateMeeting("content", e.target.value)}
            />

            <div className={`tx-panel ${txVisible ? "" : "hidden"}`}>
              <div className="gp-head">
                <span className="gp-label">Live Transcript</span>
                <button className="gp-close" onClick={toggleTranscript}>
                  ✕
                </button>
              </div>
              <div className="gp-body" ref={txBodyRef}>
                {liveTranscript.length === 0 ? (
                  <div className="tx-placeholder">
                    Press Record to start local transcription...
                  </div>
                ) : (
                  liveTranscript.map((line, idx) => (
                    <div className="tline" key={idx}>
                      <span className="ts">{line.timestamp}</span>
                      {line.text}
                    </div>
                  ))
                )}
                {isProcessing && (
                  <div className="tx-placeholder" style={{ animation: "gpulse 1.4s ease-in-out infinite" }}>
                    Transcribing audio...
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status Bar */}
          <div className="statusbar">
            <div
              className={`gpulse ${isRecording ? "active" : ""}`}
            />
            <span className="status-txt">{statusText}</span>
          </div>
        </div>
      </div>

      {/* Action Drawer */}
      <div className={`drawer ${showDrawer ? "open" : ""}`}>
        <div className="di">
          <div className="di-title">
            <span>Action Items</span>
            <span className="di-badge">
              {activeMeeting?.todos.length || 0} items · {doneCount} done
            </span>
          </div>
          <div className="todo-list">
            {activeMeeting?.todos.map((todo) => (
              <div className="titem" key={todo.id}>
                <div
                  className={`tcheck ${todo.done ? "done" : ""}`}
                  onClick={() => checkTodo(todo.id)}
                >
                  ✓
                </div>
                <span className={`ttxt ${todo.done ? "done" : ""}`}>
                  {todo.text}
                </span>
              </div>
            ))}
          </div>
          <div className="add-row">
            <input
              type="text"
              className="new-todo-input"
              placeholder="Tambah action item..."
              onKeyDown={addTodo}
            />
            <span className="add-hint">↵ enter</span>
          </div>
        </div>
      </div>

      {/* Error Toast */}
      {error && <div className="error-toast">{error}</div>}
    </div>
  );
}

export default App;
