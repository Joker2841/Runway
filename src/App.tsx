import { useState, useRef, useEffect } from "react";
import {
  Copy,
  RefreshCw,
  Check,
  ArrowRight,
  Loader2,
  UploadCloud,
  X,
  FileText,
  Settings,
  ArrowLeft,
  Radio,
  AlertTriangle,
  LogOut,
  Trash2,
} from "lucide-react";
import { SYSTEM_INSTRUCTION, RESUME_SYSTEMS, RESUME_ML } from "./constants";
import { motion, AnimatePresence } from "motion/react";
import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  deleteDoc,
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  User,
} from "firebase/auth";

interface ResumeFile {
  id: string;
  name: string;
  file: File;
}

interface CommitmentStatus {
  label: "ON TRACK" | "CUTTING IT CLOSE" | "CRITICAL" | "LANDED";
  colorClass: string;
  badgeClass: string;
}

function getCommitmentStatus(item: any): CommitmentStatus {
  const now = new Date();

  if (item.completed === true) {
    return {
      label: "LANDED",
      colorClass: "text-zinc-500",
      badgeClass: "border-zinc-800 bg-zinc-950/20 text-zinc-500",
    };
  }

  if (!item.deadlineISO) {
    return {
      label: "ON TRACK",
      colorClass: "text-emerald-500",
      badgeClass: "border-emerald-900/40 bg-emerald-950/10 text-emerald-400",
    };
  }

  try {
    const deadlineDate = new Date(item.deadlineISO);
    const startByDate = item.startByISO ? new Date(item.startByISO) : null;
    const effortHours = typeof item.effortHours === "number" ? item.effortHours : 0;

    const msToDeadline = deadlineDate.getTime() - now.getTime();
    const hoursToDeadline = msToDeadline / (1000 * 60 * 60);

    if (now >= deadlineDate || hoursToDeadline < effortHours) {
      return {
        label: "CRITICAL",
        colorClass: "text-rose-500",
        badgeClass: "border-rose-900/40 bg-rose-950/10 text-rose-400",
      };
    }

    if (startByDate && now >= startByDate) {
      return {
        label: "CUTTING IT CLOSE",
        colorClass: "text-amber-500",
        badgeClass: "border-amber-900/40 bg-amber-950/10 text-amber-400",
      };
    }
  } catch (e) {
    // fallback
  }

  return {
    label: "ON TRACK",
    colorClass: "text-emerald-500",
    badgeClass: "border-emerald-900/40 bg-emerald-950/10 text-emerald-400",
  };
}

function formatStartBy(startByISO: string | null) {
  if (!startByISO) return null;
  try {
    const d = new Date(startByISO);
    if (isNaN(d.getTime())) return null;
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    return `Start by: ${weekday} ${time}`;
  } catch (e) {
    return null;
  }
}

function getLiveCountdown(item: any, now: Date) {
  if (!item.deadlineISO) return null;
  
  try {
    const deadlineDate = new Date(item.deadlineISO);
    if (isNaN(deadlineDate.getTime())) return null;
    const nowMs = now.getTime();
    
    // 3. When the deadline itself has passed, show "Overdue"
    if (nowMs >= deadlineDate.getTime()) {
      return {
        text: "Overdue",
        textClass: "text-red-500 font-semibold uppercase tracking-wider text-[10px] font-mono"
      };
    }

    if (item.startByISO) {
      const startByDate = new Date(item.startByISO);
      if (isNaN(startByDate.getTime())) return null;
      const startByMs = startByDate.getTime();

      if (nowMs >= startByMs) {
        // 2. When startByISO has passed but the deadline has not, show "Start window passed"
        return {
          text: "Start window passed",
          textClass: "text-amber-500 font-medium uppercase tracking-wider text-[10px] font-mono"
        };
      }

      // Countdown to startByISO
      const diffMs = startByMs - nowMs;
      const totalSeconds = Math.floor(diffMs / 1000);
      const days = Math.floor(totalSeconds / (3600 * 24));
      const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      let timeStr = "";
      if (days > 0) {
        timeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
      } else if (hours > 0) {
        timeStr = `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        timeStr = `${minutes}m ${seconds}s`;
      } else {
        timeStr = `${seconds}s`;
      }

      let textClass = "text-zinc-500 font-mono text-[10px]";
      if (diffMs < 3600 * 1000) {
        // less than 1 hour: shift color towards red/critical and add pulse
        textClass = "text-rose-400 font-semibold animate-pulse font-mono text-[10px]";
      } else if (diffMs < 4 * 3600 * 1000) {
        // less than 4 hours: transition towards amber
        textClass = "text-amber-400 font-medium font-mono text-[10px]";
      } else if (diffMs < 12 * 3600 * 1000) {
        textClass = "text-zinc-300 font-mono text-[10px]";
      }

      return {
        text: `Start in ${timeStr}`,
        textClass
      };
    }
  } catch (e) {
    // fallback
  }
  return null;
}

const DEMO_EMAILS = [
  {
    id: "demo-msg-1",
    from: "hr@acmeco.com (Acme Corp HR)",
    subject: "Summer Engineering Internship Offer - Acme Corp",
    date: "Wed, 24 Jun 2026 09:00:00 -0700",
    snippet: "confirm your acceptance by submitting the signed form by tomorrow at 5pm",
    body: "Dear student, We are thrilled to offer you the Software Engineering Internship. Please review the attached offer letter and confirm your acceptance by submitting the signed form by tomorrow at 5pm. Congratulations!"
  },
  {
    id: "demo-msg-2",
    from: "prof.arnold@university.edu (Professor Arnold)",
    subject: "URGENT: Research Proposal draft feedback",
    date: "Wed, 24 Jun 2026 08:30:00 -0700",
    snippet: "Please send me the updated draft of your research proposal by Friday at noon",
    body: "Hello, Please send me the updated draft of your research proposal by Friday at noon so we can submit it to the NSF grant portal. Best, Prof. Arnold."
  },
  {
    id: "demo-msg-3",
    from: "recruiting@runwaysystems.io (Runway Systems Recruiting)",
    subject: "Runway Systems - Technical Interview Schedule",
    date: "Wed, 24 Jun 2026 10:15:00 -0700",
    snippet: "Please pick a slot on our Calendly by tonight at 11:59pm",
    body: "Hi there, We would love to schedule a 45-minute technical interview with you next Monday. Please pick a slot on our Calendly by tonight at 11:59pm. Thanks, Runway Systems Recruiting."
  },
  {
    id: "demo-msg-4",
    from: "newsletter@techcrunch.com (TechCrunch Digest)",
    subject: "Weekly Tech Crunch Digest: The Future of Agentic AI",
    date: "Tue, 23 Jun 2026 12:00:00 -0700",
    snippet: "Welcome to your weekly digest. This week, we explore how LLMs are changing the software",
    body: "Welcome to your weekly digest. This week, we explore how LLMs are changing the software development lifecycle. Read more on our website. No action is required. This is a read-only newsletter."
  }
];

function isPlausibleGradYear(yr: string): boolean {
  const trimmed = yr.trim();
  if (!trimmed) return true; // Empty is fine (not provided)
  if (!/^\d{4}$/.test(trimmed)) return false;
  const val = parseInt(trimmed, 10);
  return val >= 1950 && val <= 2100;
}

function toBase64Url(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = "";
  const len = data.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseSubjectAndBody(text: string, defaultSubject: string) {
  const lines = text.split("\n");
  let subject = defaultSubject;
  const bodyLines = [];
  let foundSubject = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!foundSubject && /^subject:\s*/i.test(line)) {
      subject = line.replace(/^subject:\s*/i, "").trim();
      foundSubject = true;
    } else {
      bodyLines.push(line);
    }
  }
  
  if (!foundSubject) {
    return { subject: defaultSubject, body: text };
  }
  
  const body = bodyLines.join("\n").trim();
  return { subject, body };
}

function computeReflection(item: {
  createdAt?: string;
  completedAt?: string;
  deadlineISO?: string | null;
  startByISO?: string | null;
  effortHours?: number | null;
}): string {
  const effort = typeof item.effortHours === "number" ? item.effortHours : 0;
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const completed = item.completedAt ? new Date(item.completedAt) : new Date();
  
  let durationStr = "";
  if (created) {
    const diffMs = completed.getTime() - created.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) {
      const mins = Math.round(diffHours * 60);
      durationStr = `${mins}m`;
    } else {
      durationStr = `${diffHours.toFixed(1)}h`;
    }
  }

  const deadline = item.deadlineISO ? new Date(item.deadlineISO) : null;
  const startBy = item.startByISO ? new Date(item.startByISO) : null;

  let timingStr = "Completed within the planned window.";
  if (deadline && completed > deadline) {
    timingStr = "Completed after the hard deadline.";
  } else if (startBy && completed > startBy) {
    timingStr = "Completed after the computed start-by time, cutting it close.";
  } else if (startBy && completed <= startBy) {
    timingStr = "Completed early, before the computed start-by time.";
  }

  const effortStr = effort > 0 ? `Estimated ${effort}h. ` : "";
  const actualStr = durationStr ? `Took ${durationStr} from capture to completion. ` : "";

  return `${effortStr}${actualStr}${timingStr}`;
}

const computeEmailFingerprint = (sender: string, subject: string): string => {
  const cleanSender = (sender || "").toLowerCase().replace(/\s+/g, " ").trim();
  const cleanSubject = (subject || "").toLowerCase().replace(/\s+/g, " ").trim();
  return `fingerprint:${cleanSender}|${cleanSubject}`;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [view, setView] = useState<"dashboard" | "new_commitment" | "detail">("dashboard");
  const [commitments, setCommitments] = useState<any[]>([]);
  const [selectedCommitment, setSelectedCommitment] = useState<any | null>(null);
  const [loadingCommitments, setLoadingCommitments] = useState(true);

  const [commitment, setCommitment] = useState("");
  const [cleanTitle, setCleanTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [context, setContext] = useState("");

  const [resumeFiles, setResumeFiles] = useState<ResumeFile[]>([]);
  const [useTextFallback, setUseTextFallback] = useState(false);
  const [resumeText, setResumeText] = useState("");

  const [phase, setPhase] = useState<"capture" | "context">("capture");
  const [archetype, setArchetype] = useState<
    | "Inbound Inquiry"
    | "Job Application"
    | "Long-form Writing"
    | "Actionable Task"
    | ""
  >("");
  const [classifying, setClassifying] = useState(false);

  const [status, setStatus] = useState<
    "idle" | "drafting" | "review" | "approved" | "error"
  >("idle");
  const [agentReasoning, setAgentReasoning] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [currentDraftDocId, setCurrentDraftDocId] = useState<string | null>(null);
  const [confirmingDeleteDraftId, setConfirmingDeleteDraftId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const [currentDeadlineISO, setCurrentDeadlineISO] = useState<string | null>(null);
  const [currentStartByISO, setCurrentStartByISO] = useState<string | null>(null);
  const [currentEffortHours, setCurrentEffortHours] = useState<number | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(
    () => localStorage.getItem("runway_google_access_token") || null
  );
  const [defending, setDefending] = useState(false);
  const [defendError, setDefendError] = useState<string | null>(null);

  const [toRecipient, setToRecipient] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [addingToTasks, setAddingToTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const [radarCandidates, setRadarCandidates] = useState<any[] | null>(null);
  const [scanningRadar, setScanningRadar] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [candidateDeadlines, setCandidateDeadlines] = useState<Record<string, string>>({});
  const [candidateTitles, setCandidateTitles] = useState<Record<string, string>>({});
  const [candidateErrors, setCandidateErrors] = useState<Record<string, string>>({});
  const [processingCandidateId, setProcessingCandidateId] = useState<string | null>(null);
  const [useDemoInbox, setUseDemoInbox] = useState(false);

  const [landedSuccess, setLandedSuccess] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [commitmentsError, setCommitmentsError] = useState<string | null>(null);

  const [briefingText, setBriefingText] = useState<string | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());

  const lastFetchedBriefingRef = useRef<string>("");

  const getCompletedCommitmentsSummary = () => {
    return commitments.filter(c => c.completed === true).map(c => {
      const completedAt = c.completedAt;
      const startByISO = c.startByISO;
      const deadlineISO = c.deadlineISO;
      let timing = "on-time";
      if (completedAt) {
        const compDate = new Date(completedAt);
        if (deadlineISO && compDate > new Date(deadlineISO)) {
          timing = "late";
        } else if (startByISO) {
          const startByDate = new Date(startByISO);
          if (compDate <= startByDate) {
            timing = "early";
          } else {
            timing = "on-time";
          }
        }
      }
      return {
        title: c.title,
        archetype: c.archetype,
        timing,
        effortHours: c.effortHours || null,
      };
    });
  };

  const getActiveListKey = (activeList: any[]) => {
    return activeList
      .map(
        (c) =>
          `${c.id}:${c.completed === true}:${getCommitmentStatus(c).label}:${
            c.deadline
          }:${c.startByISO || ""}`
      )
      .join("|");
  };

  const fetchPreflightBriefing = async (activeList: any[], force: boolean = false) => {
    const listKey = getActiveListKey(activeList);
    if (!force && lastFetchedBriefingRef.current === listKey) {
      return;
    }
    lastFetchedBriefingRef.current = listKey;

    setLoadingBriefing(true);
    setBriefingError(null);
    try {
      const currentLocalTime = new Date().toISOString();
      const response = await fetch("/api/preflight-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitments: activeList.map(c => ({
            title: c.title,
            archetype: c.archetype,
            deadline: c.deadline,
            deadlineISO: c.deadlineISO || null,
            startByISO: c.startByISO || null,
            statusLabel: getCommitmentStatus(c).label,
          })),
          completedCommitments: getCompletedCommitmentsSummary(),
          currentLocalTime,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate briefing");
      }

      let data;
      try {
        data = await response.json();
      } catch (parseErr) {
        throw new Error("Couldn't process runway briefing, please try again.");
      }

      if (!data) {
        throw new Error("Empty transmission from runway control. Please try refreshing.");
      }
      setBriefingText(data.briefing || "No briefing available.");
    } catch (err: any) {
      console.error("Error fetching briefing:", err);
      setBriefingError(err.message || "Failed to load briefing.");
    } finally {
      setLoadingBriefing(false);
    }
  };

  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState(
    () => localStorage.getItem("runway_profile_name") || "",
  );
  const [profileEmail, setProfileEmail] = useState(
    () => localStorage.getItem("runway_profile_email") || "",
  );
  const [profileInstitute, setProfileInstitute] = useState(
    () => localStorage.getItem("runway_profile_institute") || "",
  );
  const [profileGradYear, setProfileGradYear] = useState(
    () => localStorage.getItem("runway_profile_grad_year") || "",
  );

  // Sync access token to localStorage
  useEffect(() => {
    if (accessToken) {
      localStorage.setItem("runway_google_access_token", accessToken);
    } else {
      localStorage.removeItem("runway_google_access_token");
    }
  }, [accessToken]);

  // Reset/initialize toRecipient when selectedCommitment changes
  useEffect(() => {
    if (selectedCommitment) {
      if (selectedCommitment.source === "radar" && selectedCommitment.sender) {
        setToRecipient(selectedCommitment.sender);
      } else {
        setToRecipient("");
      }
      setDraftError(null);
    } else {
      setToRecipient("");
      setDraftError(null);
    }
  }, [selectedCommitment]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setCheckingAuth(false);
      if (currentUser) {
        if (currentUser.displayName && !localStorage.getItem("runway_profile_name")) {
          setProfileName(currentUser.displayName);
        }
        if (currentUser.email && !localStorage.getItem("runway_profile_email")) {
          setProfileEmail(currentUser.email);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSignInWithGoogle = async () => {
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
      provider.addScope("https://www.googleapis.com/auth/gmail.compose");
      provider.addScope("https://www.googleapis.com/auth/calendar");
      provider.addScope("https://www.googleapis.com/auth/calendar.events");
      provider.addScope("https://www.googleapis.com/auth/tasks");
      
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        setAccessToken(credential.accessToken);
        localStorage.setItem("runway_google_access_token", credential.accessToken);
      }
    } catch (err: any) {
      console.error("Error signing in with Google:", err);
      setAuthError(err.message || "Failed to sign in with Google.");
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setAccessToken(null);
      localStorage.removeItem("runway_google_access_token");
      setCommitments([]);
      setView("dashboard");
      setShowProfile(false);
    } catch (err: any) {
      console.error("Error signing out:", err);
    }
  };

  useEffect(() => {
    const fetchCommitments = async () => {
      if (!user) {
        setCommitments([]);
        setLoadingCommitments(false);
        return;
      }
      setLoadingCommitments(true);
      setCommitmentsError(null);
      try {
        const q = query(
          collection(db, "commitments"),
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc")
        );
        const querySnapshot = await getDocs(q);
        const list: any[] = [];
        querySnapshot.forEach((doc) => {
          list.push({ ...doc.data(), id: doc.id, docId: doc.id });
        });
        setCommitments(list);
        const activeList = list.filter((c) => c.completed !== true && c.status !== "draft");
        fetchPreflightBriefing(activeList);
      } catch (err: any) {
        console.error("Error fetching commitments from firestore:", err);
        setCommitmentsError(err.message || "Failed to load commitments from database.");
        try {
          handleFirestoreError(err, OperationType.LIST, "commitments");
        } catch (_) {}
      } finally {
        setLoadingCommitments(false);
      }
    };
    fetchCommitments();
  }, [user]);

  useEffect(() => {
    if (view === "dashboard" && !loadingCommitments && user) {
      const activeList = commitments.filter((c) => c.completed !== true && c.status !== "draft");
      fetchPreflightBriefing(activeList);
    }
  }, [view, loadingCommitments, user]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedCommitment?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const trimmed = profileName.trim();
    if (trimmed) {
      localStorage.setItem("runway_profile_name", trimmed);
    } else {
      localStorage.removeItem("runway_profile_name");
    }
  }, [profileName]);

  useEffect(() => {
    const trimmed = profileEmail.trim();
    if (trimmed) {
      localStorage.setItem("runway_profile_email", trimmed);
    } else {
      localStorage.removeItem("runway_profile_email");
    }
  }, [profileEmail]);

  useEffect(() => {
    const trimmed = profileInstitute.trim();
    if (trimmed) {
      localStorage.setItem("runway_profile_institute", trimmed);
    } else {
      localStorage.removeItem("runway_profile_institute");
    }
  }, [profileInstitute]);

  useEffect(() => {
    const trimmed = profileGradYear.trim();
    if (trimmed) {
      localStorage.setItem("runway_profile_grad_year", trimmed);
    } else {
      localStorage.removeItem("runway_profile_grad_year");
    }
  }, [profileGradYear]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [draftContent]);

  useEffect(() => {
    if (!currentDraftDocId || status !== "review" || !user?.uid) return;

    const timer = setTimeout(async () => {
      try {
        await setDoc(
          doc(db, "commitments", currentDraftDocId),
          { approvedArtifact: draftContent },
          { merge: true }
        );
        // Also update local commitments state
        setCommitments((prev) =>
          prev.map((c) =>
            c.docId === currentDraftDocId
              ? { ...c, approvedArtifact: draftContent }
              : c
          )
        );
      } catch (err) {
        console.error("Failed to auto-save draft edit:", err);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [draftContent, currentDraftDocId, status, user?.uid]);

  const handleFileChange = (e: any) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files as any).map((file: any) => ({
        id: Math.random().toString(36).substring(7),
        name: file.name,
        file,
      }));
      setResumeFiles((prev) => [...prev, ...newFiles]);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (id: string) => {
    setResumeFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const loadSamples = () => {
    setUseTextFallback(true);
    setResumeText(
      `--- RESUME (SYSTEMS) ---\n${RESUME_SYSTEMS}\n\n--- RESUME (ML) ---\n${RESUME_ML}`,
    );
  };

  const toBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        let encoded = reader.result?.toString() || "";
        const commaIdx = encoded.indexOf(",");
        if (commaIdx !== -1) {
          encoded = encoded.substring(commaIdx + 1);
        }
        resolve(encoded);
      };
      reader.onerror = (error) => reject(error);
    });

  const handleContinue = async () => {
    if (classifying) return;
    const cleanCommitment = commitment ? commitment.trim() : "";
    if (!cleanCommitment) {
      setErrorMsg("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      return;
    }
    const lowerCommitment = cleanCommitment.toLowerCase();
    const JUNK_TERMS = [
      "s", "asdf", "xyz", "junk", "temp", "test", "test task", "dummy", "etc", "foo", "bar",
      "something", "stuff", "a thing", "task", "anything", "nothing", "a task", "some stuff", "some thing"
    ];
    if (cleanCommitment.length <= 1 || JUNK_TERMS.includes(lowerCommitment)) {
      setErrorMsg("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      return;
    }
    if (cleanCommitment.length > 2000) {
      setErrorMsg("That's a bit too long! Please keep your commitment concise (under 500 characters) so the agent can plan precisely.");
      return;
    }
    if (!deadline || !deadline.trim() || deadline.trim().length <= 1) {
      setErrorMsg("Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.");
      return;
    }
    setClassifying(true);
    setErrorMsg("");
    try {
      const processedCommitment = cleanCommitment.length > 1000 ? cleanCommitment.slice(0, 1000) : cleanCommitment;
      const res = await fetch("/api/classify-commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitment: processedCommitment, deadline }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to classify commitment.");
      }
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        throw new Error("Couldn't process commitment analysis, please try again.");
      }
      if (!data) {
        throw new Error("Unable to parse classification response. Please try again.");
      }
      if (data.commitmentInvalid) {
        throw new Error("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      }
      if (data.deadlineInvalid) {
        throw new Error("Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.");
      }
      setArchetype(data.archetype || "Actionable Task");
      setCleanTitle(data.title || cleanCommitment);
      setPhase("context");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setClassifying(false);
    }
  };

  const handleDraft = async () => {
    if (!profileName || !profileName.trim()) {
      setShowNamePrompt(true);
    }
    const cleanCommitment = commitment ? commitment.trim() : "";
    if (!cleanCommitment) {
      setErrorMsg("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      return;
    }
    const lowerCommitment = cleanCommitment.toLowerCase();
    const JUNK_TERMS = [
      "s", "asdf", "xyz", "junk", "temp", "test", "test task", "dummy", "etc", "foo", "bar",
      "something", "stuff", "a thing", "task", "anything", "nothing", "a task", "some stuff", "some thing"
    ];
    if (cleanCommitment.length <= 1 || JUNK_TERMS.includes(lowerCommitment)) {
      setErrorMsg("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      return;
    }
    if (cleanCommitment.length > 2000) {
      setErrorMsg("That's a bit too long! Please keep your commitment concise (under 500 characters) so the agent can plan precisely.");
      return;
    }
    if (!deadline || !deadline.trim() || deadline.trim().length <= 1) {
      setErrorMsg("Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.");
      return;
    }
    if (archetype === "Job Application") {
      if (!useTextFallback && resumeFiles.length === 0) {
        setErrorMsg(
          "Please upload at least one resume PDF, or use the text fallback.",
        );
        return;
      }
      if (useTextFallback && !resumeText.trim()) {
        setErrorMsg("Please paste your resume text.");
        return;
      }
    }

    setStatus("drafting");
    setErrorMsg("");
    setAgentReasoning("");
    setDraftContent("");
    setCurrentDeadlineISO(null);
    setCurrentStartByISO(null);
    setCurrentEffortHours(null);

    try {
      let resumesPayload = [];
      if (archetype === "Job Application" && !useTextFallback) {
        for (const r of resumeFiles) {
          const b64 = await toBase64(r.file);
          resumesPayload.push({
            data: b64,
            mimeType: r.file.type || "application/pdf",
            name: r.name,
          });
        }
      }

      const res = await fetch("/api/generate-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitment,
          deadline,
          context,
          profile: {
            name: profileName,
            institute: profileInstitute,
            gradYear: profileGradYear,
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          resumes:
            archetype === "Job Application" && !useTextFallback
              ? resumesPayload
              : [],
          resumeText:
            archetype === "Job Application" && useTextFallback
              ? resumeText
              : "",
          currentLocalTime: new Date().toString(),
          completedCommitments: getCompletedCommitmentsSummary(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate draft.");
      }

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        throw new Error("Couldn't process draft generation, please try again.");
      }
      if (!data || (!data.artifact && !data.reasoning_trace)) {
        throw new Error("Draft could not be generated. Please refine your context or try again.");
      }

      if (data.deadlineISO === "INVALID") {
        throw new Error("Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.");
      }

      const draftArtifact = data.artifact || "";
      const draftReasoning = data.reasoning_trace || "";
      const draftDeadlineISO = data.deadlineISO || null;
      const draftStartByISO = data.startByISO || null;
      const draftEffortHours = typeof data.effortHours === "number" ? data.effortHours : null;
      const draftArchetype = data.archetype || archetype;

      setAgentReasoning(draftReasoning);
      setDraftContent(draftArtifact);
      setCurrentDeadlineISO(draftDeadlineISO);
      setCurrentStartByISO(draftStartByISO);
      setCurrentEffortHours(draftEffortHours);
      if (data.archetype) {
        setArchetype(data.archetype);
      }

      // 1. AUTO-SAVE AS DRAFT to Firestore
      const draftData = {
        title: cleanTitle || commitment,
        originalCommitment: commitment,
        deadline: deadline,
        archetype: draftArchetype,
        approvedArtifact: draftArtifact,
        reasoningTrace: draftReasoning,
        source: "manual",
        createdAt: new Date().toISOString(),
        deadlineISO: draftDeadlineISO,
        startByISO: draftStartByISO,
        effortHours: draftEffortHours,
        userId: user?.uid,
        status: "draft",
      };

      let docIdToUse = currentDraftDocId;
      try {
        if (!docIdToUse) {
          const docRef = await addDoc(collection(db, "commitments"), draftData);
          docIdToUse = docRef.id;
          await setDoc(docRef, { id: docIdToUse, docId: docIdToUse }, { merge: true });
          setCurrentDraftDocId(docIdToUse);
        } else {
          await setDoc(doc(db, "commitments", docIdToUse), draftData, { merge: true });
        }

        // Add/update draft in local commitments state
        const savedDraftFull = {
          ...draftData,
          id: docIdToUse,
          docId: docIdToUse,
        };
        setCommitments((prev) => {
          const filtered = prev.filter((c) => c.docId !== docIdToUse);
          return [savedDraftFull, ...filtered];
        });
      } catch (saveErr: any) {
        console.error("Failed to auto-save draft to Firestore:", saveErr);
        try {
          handleFirestoreError(saveErr, OperationType.WRITE, "commitments");
        } catch (_) {}
      }

      setStatus("review");
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draftContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  };

  const handleApprove = async () => {
    const newCommitmentData = {
      title: cleanTitle || commitment,
      originalCommitment: commitment,
      deadline: deadline,
      archetype: archetype,
      approvedArtifact: draftContent,
      reasoningTrace: agentReasoning,
      source: "manual",
      createdAt: new Date().toISOString(),
      deadlineISO: currentDeadlineISO,
      startByISO: currentStartByISO,
      effortHours: currentEffortHours,
      userId: user?.uid,
      status: "active",
    };

    try {
      let finalId = currentDraftDocId;
      if (finalId) {
        // Update the existing draft to be active
        const docRef = doc(db, "commitments", finalId);
        await setDoc(docRef, newCommitmentData, { merge: true });
      } else {
        // Fallback: create fresh if no draft doc exists
        const docRef = await addDoc(collection(db, "commitments"), newCommitmentData);
        finalId = docRef.id;
        await setDoc(docRef, { id: finalId, docId: finalId }, { merge: true });
      }

      const finalCommitment = {
        ...newCommitmentData,
        id: finalId,
        docId: finalId,
      };

      // Update local state
      setCommitments((prev) => {
        const filtered = prev.filter((c) => c.docId !== finalId);
        const newList = [finalCommitment, ...filtered];
        const activeList = newList.filter((c) => c.completed !== true && c.status !== "draft");
        fetchPreflightBriefing(activeList);
        return newList;
      });

      // Reset drafting/creation states
      setCommitment("");
      setCleanTitle("");
      setDeadline("");
      setContext("");
      setArchetype("");
      setAgentReasoning("");
      setDraftContent("");
      setCurrentDeadlineISO(null);
      setCurrentStartByISO(null);
      setCurrentEffortHours(null);
      setCurrentDraftDocId(null);
      setPhase("capture");
      setStatus("idle");
      setErrorMsg("");

      // Navigate to dashboard
      setView("dashboard");
    } catch (err: any) {
      console.error("Failed to save commitment to Firestore:", err);
      setErrorMsg("Failed to save approved commitment: " + err.message);
      try {
        handleFirestoreError(err, OperationType.WRITE, "commitments");
      } catch (_) {}
    }
  };

  const handleResumeDraft = (item: any) => {
    setCommitment(item.originalCommitment || item.title || "");
    setCleanTitle(item.title || "");
    setDeadline(item.deadline || "");
    setArchetype(item.archetype || "");
    setDraftContent(item.approvedArtifact || "");
    setAgentReasoning(item.reasoningTrace || "");
    setCurrentDeadlineISO(item.deadlineISO || null);
    setCurrentStartByISO(item.startByISO || null);
    setCurrentEffortHours(item.effortHours || null);
    setCurrentDraftDocId(item.id || item.docId || null);
    setPhase("context");
    setStatus("review");
    setView("new_commitment");
    setErrorMsg("");
  };

  const handleDeleteDraftConfirm = async (item: any) => {
    const targetDocId = item.id || item.docId;
    if (!targetDocId) return;
    try {
      setCommitmentsError(null);
      await deleteDoc(doc(db, "commitments", targetDocId));
      setCommitments((prev) => prev.filter((c) => c.docId !== targetDocId));
      setConfirmingDeleteDraftId(null);
    } catch (err: any) {
      console.error("Failed to delete draft:", err);
      setCommitmentsError(err.message || "Failed to delete draft.");
      try {
        handleFirestoreError(err, OperationType.DELETE, `commitments/${targetDocId}`);
      } catch (_) {}
    }
  };

  const handleScanRadar = async () => {
    setScanningRadar(true);
    setRadarError(null);
    try {
      let formattedEmails = [];
      if (useDemoInbox) {
        formattedEmails = DEMO_EMAILS;
        await new Promise((r) => setTimeout(r, 1200)); // Simulate realistic network delay
      } else {
        let currentToken = accessToken;
        if (!currentToken) {
          const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
          const { auth } = await import("./firebase");
          const provider = new GoogleAuthProvider();
          provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
          provider.addScope("https://www.googleapis.com/auth/gmail.compose");
          provider.addScope("https://www.googleapis.com/auth/calendar");
          provider.addScope("https://www.googleapis.com/auth/calendar.events");
          provider.addScope("https://www.googleapis.com/auth/tasks");
          
          const result = await signInWithPopup(auth, provider);
          const credential = GoogleAuthProvider.credentialFromResult(result);
          if (!credential || !credential.accessToken) {
            throw new Error("Could not acquire Google access token from authorization.");
          }
          currentToken = credential.accessToken;
          setAccessToken(currentToken);
        }

        const listResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25", {
          headers: {
            "Authorization": `Bearer ${currentToken}`,
          },
        });

        if (!listResponse.ok) {
          if (listResponse.status === 401 || listResponse.status === 403) {
            setAccessToken(null);
            throw new Error("Authorization expired or missing permissions. Please click 'Scan inbox (Radar)' again to grant permissions.");
          }
          throw new Error(`Gmail API returned status ${listResponse.status}`);
        }

        const listData = await listResponse.json();
        const messages = listData.messages || [];

        if (messages.length === 0) {
          setRadarCandidates([]);
          return;
        }

        const detailedMessages = await Promise.all(
          messages.map(async (msg: any) => {
            try {
              const detailResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
                headers: {
                  "Authorization": `Bearer ${currentToken}`,
                }
              });
              if (!detailResponse.ok) return null;
              return await detailResponse.json();
            } catch (e) {
              return null;
            }
          })
        );

        const getHeader = (headers: any[], name: string): string => {
          const header = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
          return header ? header.value : "";
        };

        const getMessageBody = (payload: any): string => {
          if (!payload) return "";
          if (payload.mimeType === "text/plain" && payload.body?.data) {
            try {
              const base64 = payload.body.data.replace(/-/g, "+").replace(/_/g, "/");
              return decodeURIComponent(
                atob(base64)
                  .split("")
                  .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                  .join("")
              );
            } catch (e) {
              try {
                return atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
              } catch (err) {
                return "";
              }
            }
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              const body = getMessageBody(part);
              if (body) return body;
            }
          }
          return "";
        };

        const getEmailBody = (msg: any): string => {
          let body = "";
          if (msg.payload) {
            body = getMessageBody(msg.payload);
          }
          return body || msg.snippet || "";
        };

        formattedEmails = detailedMessages
          .filter(Boolean)
          .map((msg: any) => {
            const headers = msg.payload?.headers || [];
            const from = getHeader(headers, "from");
            const subject = getHeader(headers, "subject");
            const date = getHeader(headers, "date");
            const body = getEmailBody(msg);
            return {
              id: msg.id,
              from,
              subject,
              date,
              snippet: msg.snippet || "",
              body: body.slice(0, 800),
            };
          });
      }

      const serverResponse = await fetch("/api/scan-radar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emails: formattedEmails }),
      });

      if (!serverResponse.ok) {
        const errBody = await serverResponse.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to analyze inbox with Radar.");
      }

      let scanResult;
      try {
        scanResult = await serverResponse.json();
      } catch (parseErr) {
        throw new Error("Couldn't process Radar results, please try again.");
      }
      if (!scanResult || !Array.isArray(scanResult.commitments)) {
        throw new Error("Empty or malformed payload received from Radar service. Please try scanning again.");
      }
      const rawList = scanResult.commitments;

      // 1. Enrich candidates with subject/from/body and generate sourceEmailId
      const enrichedList = rawList.map((cand: any) => {
        const orig = formattedEmails.find((e: any) => e.id === cand.emailId);
        const emailId = cand.emailId || orig?.id || null;
        const subject = orig?.subject || cand.subject || "";
        const sender = cand.sender || orig?.from || "";
        const title = cand.title || "";

        // Compute fingerprint using stable fields only (sender + subject)
        const fingerprint = computeEmailFingerprint(sender, subject);
        const sourceEmailId = emailId || fingerprint;

        return {
          ...cand,
          emailId,
          subject,
          sender,
          sourceEmailId,
        };
      });

      // 2. Deduplicate on Scan: Exclude candidates whose source email already corresponds to an active or completed commitment
      const filteredList = enrichedList.filter((cand: any) => {
        const isDuplicate = commitments.some((existing: any) => {
          // A. If Gmail ID (emailId) matches, it's a duplicate
          if (cand.emailId && existing.emailId && cand.emailId === existing.emailId) {
            return true;
          }
          if (cand.emailId && existing.sourceEmailId && cand.emailId === existing.sourceEmailId) {
            return true;
          }

          // B. Match by stable fingerprint of (sender + subject)
          const candFingerprint = computeEmailFingerprint(cand.sender, cand.subject);
          
          if (existing.sourceEmailId && existing.sourceEmailId === candFingerprint) {
            return true;
          }
          if (existing.emailId && existing.emailId === candFingerprint) {
            return true;
          }

          // Check if existing commitment has sender and subject to compute same fingerprint
          if (existing.sender && existing.subject) {
            const existingFingerprint = computeEmailFingerprint(existing.sender, existing.subject);
            if (existingFingerprint === candFingerprint) {
              return true;
            }
          }

          return false;
        });
        return !isDuplicate;
      });

      setRadarCandidates(filteredList);

      // Initialize candidate editing states
      const initialDeadlines: Record<string, string> = {};
      const initialTitles: Record<string, string> = {};
      filteredList.forEach((cand: any, idx: number) => {
        const key = cand.emailId || String(idx);
        initialDeadlines[key] = (cand.deadline === "no clear deadline" || !cand.deadline) ? "tomorrow 5pm" : cand.deadline;
        initialTitles[key] = cand.title;
      });
      setCandidateDeadlines(initialDeadlines);
      setCandidateTitles(initialTitles);
    } catch (err: any) {
      console.error("Radar scan error:", err);
      setRadarError(err.message || "An unexpected error occurred during radar scan.");
    } finally {
      setScanningRadar(false);
    }
  };

  const handleAddCandidate = async (cand: any, idx: number) => {
    const key = cand.emailId || String(idx);
    if (processingCandidateId) return;

    if (!profileName || !profileName.trim()) {
      setShowNamePrompt(true);
    }

    const chosenTitle = candidateTitles[key] !== undefined ? candidateTitles[key] : cand.title;
    const chosenDeadline = candidateDeadlines[key] !== undefined ? candidateDeadlines[key] : cand.deadline;

    // Clear previous error
    setCandidateErrors((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });

    const cleanTitle = chosenTitle ? chosenTitle.trim() : "";
    if (!cleanTitle) {
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: "Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.",
      }));
      return;
    }
    const lowerTitle = cleanTitle.toLowerCase();
    const JUNK_TERMS = [
      "s", "asdf", "xyz", "junk", "temp", "test", "test task", "dummy", "etc", "foo", "bar",
      "something", "stuff", "a thing", "task", "anything", "nothing", "a task", "some stuff", "some thing", "one"
    ];
    if (cleanTitle.length <= 1 || JUNK_TERMS.includes(lowerTitle)) {
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: "Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.",
      }));
      return;
    }
    if (cleanTitle.length > 2000) {
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: "That's a bit too long! Please keep your commitment concise (under 500 characters) so the agent can plan precisely.",
      }));
      return;
    }

    const cleanDeadline = chosenDeadline ? chosenDeadline.trim() : "";
    if (!cleanDeadline || cleanDeadline === "no clear deadline") {
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: "Please specify a deadline for this commitment.",
      }));
      return;
    }
    if (cleanDeadline.length <= 1 || cleanDeadline.toLowerCase() === "s" || cleanDeadline.toLowerCase() === "gibberish") {
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: "Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.",
      }));
      return;
    }

    setProcessingCandidateId(key);
    try {
      // 1. CLASSIFY commitment
      const classifyRes = await fetch("/api/classify-commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitment: cleanTitle, deadline: cleanDeadline }),
      });
      if (!classifyRes.ok) {
        const errData = await classifyRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to classify commitment.");
      }
      let classifyData;
      try {
        classifyData = await classifyRes.json();
      } catch (e) {
        throw new Error("Couldn't process commitment analysis, please try again.");
      }
      if (classifyData.commitmentInvalid) {
        throw new Error("Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'.");
      }
      if (classifyData.deadlineInvalid) {
        throw new Error("Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.");
      }

      const detectedArchetype = classifyData.archetype || "Actionable Task";
      const cleanCandidateTitle = classifyData.title || cleanTitle;

      // 2. DRAFT the first domino (running existing engine flow)
      // Use original email text/context as context where relevant
      const emailContext = cand.context || cand.body || cand.snippet || `Email from ${cand.sender}`;

      const draftRes = await fetch("/api/generate-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitment: cleanTitle,
          deadline: cleanDeadline,
          context: emailContext,
          profile: {
            name: profileName,
            institute: profileInstitute,
            gradYear: profileGradYear,
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          resumes: [],
          resumeText: detectedArchetype === "Job Application" ? (resumeText || "") : "",
          currentLocalTime: new Date().toString(),
          completedCommitments: getCompletedCommitmentsSummary(),
        }),
      });

      if (!draftRes.ok) {
        const errData = await draftRes.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to generate first domino draft.");
      }

      let draftData;
      try {
        draftData = await draftRes.json();
      } catch (e) {
        throw new Error("Couldn't process draft generation, please try again.");
      }

      // 3. CREATE commitment object & save to Firestore (and local state)
      const newCommitmentData = {
        title: cleanCandidateTitle,
        originalCommitment: cleanTitle,
        deadline: cleanDeadline,
        archetype: draftData.archetype || detectedArchetype,
        approvedArtifact: draftData.artifact || "",
        reasoningTrace: draftData.reasoning_trace || "",
        source: "radar", // Distinguishes inbox-caught commitments
        sender: cand.sender || null,
        subject: cand.subject || null,
        emailId: cand.emailId || null,
        sourceEmailId: cand.sourceEmailId || cand.emailId || computeEmailFingerprint(cand.sender, cand.subject),
        createdAt: new Date().toISOString(),
        deadlineISO: draftData.deadlineISO || null,
        startByISO: draftData.startByISO || null,
        effortHours: typeof draftData.effortHours === "number" ? draftData.effortHours : null,
        defended: false,
        userId: user?.uid,
      };

      const docRef = await addDoc(collection(db, "commitments"), newCommitmentData);
      const generatedId = docRef.id;

      // Update the document to include id and docId
      await setDoc(docRef, { id: generatedId, docId: generatedId }, { merge: true });

      const finalCommitment = {
        ...newCommitmentData,
        id: generatedId,
        docId: generatedId,
      };

      // Update local state
      setCommitments((prev) => {
        const newList = [finalCommitment, ...prev];
        const activeList = newList.filter((c) => c.completed !== true && c.status !== "draft");
        fetchPreflightBriefing(activeList);
        return newList;
      });

      // Remove candidate from radar list
      setRadarCandidates((prev) => prev ? prev.filter((c, i) => (c.emailId || String(i)) !== key) : null);

    } catch (err: any) {
      console.error("Error adding candidate to Runway:", err);
      const isValidationError = err.message === "Tell me the task - e.g. 'Email Prof. Awekar about my thesis' or 'Apply to the X role'." ||
        err.message === "Couldn't understand that deadline - try something like 'tomorrow 5pm' or 'Friday'.";
      setCandidateErrors((prev) => ({
        ...prev,
        [key]: isValidationError ? err.message : `Error adding commitment: ${err.message || err}`
      }));
      if (!isValidationError) {
        try {
          handleFirestoreError(err, OperationType.WRITE, "commitments");
        } catch (_) {}
      }
    } finally {
      setProcessingCandidateId(null);
    }
  };

  const handleDefendSlot = async () => {
    if (!selectedCommitment) return;
    if (selectedCommitment.defended) return;

    setDefending(true);
    setDefendError(null);
    try {
      let currentToken = accessToken;
      if (!currentToken) {
        const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
        const { auth } = await import("./firebase");
        const provider = new GoogleAuthProvider();
        provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
        provider.addScope("https://www.googleapis.com/auth/gmail.compose");
        provider.addScope("https://www.googleapis.com/auth/calendar");
        provider.addScope("https://www.googleapis.com/auth/calendar.events");
        provider.addScope("https://www.googleapis.com/auth/tasks");
        
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential || !credential.accessToken) {
          throw new Error("Could not acquire Google Calendar access token from authorization.");
        }
        currentToken = credential.accessToken;
        setAccessToken(currentToken);
      }

      if (!selectedCommitment.startByISO) {
        throw new Error("No start time computed for this commitment.");
      }

      const start = new Date(selectedCommitment.startByISO);
      if (isNaN(start.getTime())) {
        throw new Error("Invalid start-by datetime format.");
      }
      const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 minutes later

      let actionText = "";
      const title = selectedCommitment.title || "your task";
      const arch = selectedCommitment.archetype;
      if (arch === "Job Application") {
        actionText = `Begin your ${title} cover letter`;
      } else if (arch === "Inbound Inquiry") {
        actionText = `Draft email reply for ${title}`;
      } else if (arch === "Long-form Writing") {
        actionText = `Begin your ${title} outline and opening`;
      } else {
        actionText = `Begin work on ${title}`;
      }

      const deadlineStr = selectedCommitment.deadline || "the specified deadline";
      const eventDescription = `START NOW: ${actionText}. Your first draft is ready in Runway. Deadline: ${deadlineStr}.`;

      const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${currentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `Start: ${selectedCommitment.title}`,
          description: eventDescription,
          start: {
            dateTime: start.toISOString(),
          },
          end: {
            dateTime: end.toISOString(),
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem("runway_google_access_token");
          setAccessToken(null);
          throw new Error("Authorization expired or missing permissions. Please click 'Defend' again to sign in and grant calendar access.");
        }
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Google Calendar API returned status ${response.status}`);
      }

      // Persist defended: true in Firestore
      const updatedCommitment = { ...selectedCommitment, defended: true };
      try {
        await setDoc(doc(db, "commitments", selectedCommitment.docId || selectedCommitment.id), updatedCommitment);
      } catch (fErr) {
        handleFirestoreError(fErr, OperationType.WRITE, `commitments/${selectedCommitment.docId || selectedCommitment.id}`);
      }
      
      // Update local states
      setSelectedCommitment(updatedCommitment);
      setCommitments(prev => {
        const newList = prev.map(c => (c.docId === selectedCommitment.docId || c.id === selectedCommitment.id) ? updatedCommitment : c);
        const activeList = newList.filter(c => c.completed !== true && c.status !== "draft");
        fetchPreflightBriefing(activeList);
        return newList;
      });
    } catch (err: any) {
      console.error("Defend error:", err);
      setDefendError(err.message || "An unexpected error occurred while defending your time.");
    } finally {
      setDefending(false);
    }
  };

  const handleSaveGmailDraft = async () => {
    if (!selectedCommitment) return;
    const trimmedRecipient = toRecipient.trim();
    if (trimmedRecipient) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedRecipient)) {
        setDraftError("Please enter a valid email address.");
        return;
      }
    }
    setSavingDraft(true);
    setDraftError(null);

    try {
      let currentToken = accessToken;
      const getNewToken = async () => {
        const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
        const { auth } = await import("./firebase");
        const provider = new GoogleAuthProvider();
        provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
        provider.addScope("https://www.googleapis.com/auth/gmail.compose");
        provider.addScope("https://www.googleapis.com/auth/calendar");
        provider.addScope("https://www.googleapis.com/auth/calendar.events");
        provider.addScope("https://www.googleapis.com/auth/tasks");
        
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential || !credential.accessToken) {
          throw new Error("Could not acquire Google access token from authorization.");
        }
        setAccessToken(credential.accessToken);
        return credential.accessToken;
      };

      if (!currentToken) {
        currentToken = await getNewToken();
      }

      const defaultSubject = selectedCommitment.archetype === "Inbound Inquiry"
        ? `Re: ${selectedCommitment.title}`
        : `Cover Letter - ${selectedCommitment.title}`;

      const { subject, body } = parseSubjectAndBody(selectedCommitment.approvedArtifact, defaultSubject);

      const emailParts: string[] = [];
      if (toRecipient && toRecipient.trim()) {
        emailParts.push(`To: ${toRecipient.trim()}`);
      }
      emailParts.push(`Subject: ${subject}`);
      emailParts.push("MIME-Version: 1.0");
      emailParts.push("Content-Type: text/plain; charset=utf-8");
      emailParts.push("Content-Transfer-Encoding: 7bit");
      emailParts.push("");
      emailParts.push(body);

      const emailString = emailParts.join("\r\n");
      const base64Safe = toBase64Url(emailString);

      let response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${currentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            raw: base64Safe,
          },
        }),
      });

      if (response.status === 401) {
        localStorage.removeItem("runway_google_access_token");
        setAccessToken(null);
        currentToken = await getNewToken();
        
        response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${currentToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              raw: base64Safe,
            },
          }),
        });
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem("runway_google_access_token");
          setAccessToken(null);
          throw new Error("Authorization expired or missing permissions. Please click 'Save to Gmail as draft' again to sign in and grant access.");
        }
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Gmail API returned status ${response.status}`);
      }

      const targetDocId = selectedCommitment.docId || selectedCommitment.id;
      const updatedCommitment = { 
        ...selectedCommitment, 
        gmailDraftCreated: true, 
        gmailDraftTo: toRecipient.trim() || null 
      };

      try {
        await setDoc(doc(db, "commitments", targetDocId), updatedCommitment);
      } catch (fErr) {
        handleFirestoreError(fErr, OperationType.WRITE, `commitments/${targetDocId}`);
      }
      
      setSelectedCommitment(updatedCommitment);
      setCommitments(prev => prev.map(c => (c.docId === targetDocId || c.id === targetDocId) ? updatedCommitment : c));

    } catch (err: any) {
      console.error("Gmail draft creation error:", err);
      setDraftError(err.message || "An unexpected error occurred while saving your Gmail draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  const parseChecklistSteps = (artifact: string): string[] => {
    if (!artifact) return [];
    const lines = artifact.split("\n");
    const steps: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const listCheckboxRegex = /^(?:-|\*|\d+\.)?\s*\[([ xX]?)\]\s*(.+)$/;
      const plainListRegex = /^(?:-|\*|\d+\.)\s*(.+)$/;
      
      let stepText = "";
      if (listCheckboxRegex.test(trimmed)) {
        const match = trimmed.match(listCheckboxRegex);
        if (match && match[2]) {
          stepText = match[2].trim();
        }
      } else if (plainListRegex.test(trimmed)) {
        const match = trimmed.match(plainListRegex);
        if (match && match[1]) {
          stepText = match[1].trim();
        }
      } else if (trimmed.toLowerCase().startsWith("step") && trimmed.includes(":")) {
        const parts = trimmed.split(":");
        if (parts[1]) {
          stepText = parts.slice(1).join(":").trim();
        }
      }
      
      if (stepText) {
        steps.push(stepText);
      }
    }
    
    if (steps.length === 0) {
      const nonBlank = lines.map(l => l.trim()).filter(l => l.length > 5 && l.length < 150);
      if (nonBlank.length > 0) {
        return nonBlank;
      }
    }
    
    return steps;
  };

  const handleAddToGoogleTasks = async () => {
    if (!selectedCommitment) return;
    if (selectedCommitment.googleTasksAdded) return;

    setAddingToTasks(true);
    setTasksError(null);

    try {
      let currentToken = accessToken;
      if (!currentToken) {
        const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
        const { auth } = await import("./firebase");
        const provider = new GoogleAuthProvider();
        provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
        provider.addScope("https://www.googleapis.com/auth/gmail.compose");
        provider.addScope("https://www.googleapis.com/auth/calendar");
        provider.addScope("https://www.googleapis.com/auth/calendar.events");
        provider.addScope("https://www.googleapis.com/auth/tasks");
        
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential || !credential.accessToken) {
          throw new Error("Could not acquire Google Tasks access token from authorization.");
        }
        currentToken = credential.accessToken;
        setAccessToken(currentToken);
        localStorage.setItem("runway_google_access_token", currentToken);
      }

      const steps = parseChecklistSteps(selectedCommitment.approvedArtifact);
      if (steps.length === 0) {
        throw new Error("Could not parse any checklist steps from this Actionable Task artifact.");
      }

      const response = await fetch("/api/create-google-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: currentToken,
          title: selectedCommitment.title || "Actionable Task",
          steps: steps,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem("runway_google_access_token");
          setAccessToken(null);
          throw new Error("Authorization expired or missing permissions. Please click 'Add to Google Tasks' again to sign in.");
        }
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to create Google Tasks.");
      }

      const targetDocId = selectedCommitment.docId || selectedCommitment.id;
      const updatedCommitment = { 
        ...selectedCommitment, 
        googleTasksAdded: true 
      };

      try {
        await setDoc(doc(db, "commitments", targetDocId), updatedCommitment);
      } catch (fErr) {
        handleFirestoreError(fErr, OperationType.WRITE, `commitments/${targetDocId}`);
      }
      
      setSelectedCommitment(updatedCommitment);
      setCommitments(prev => prev.map(c => (c.docId === targetDocId || c.id === targetDocId) ? updatedCommitment : c));

    } catch (err: any) {
      console.error("Google Tasks integration error:", err);
      setTasksError(err.message || "An unexpected error occurred while adding tasks to Google Tasks.");
    } finally {
      setAddingToTasks(false);
    }
  };

  const activeCommitments = commitments.filter((c) => c.completed !== true && c.status !== "draft");
  const completedCommitments = commitments.filter((c) => c.completed === true && c.status !== "draft");
  const draftCommitments = commitments.filter((c) => c.status === "draft");

  const sortedActiveCommitments = [...activeCommitments].sort((a, b) => {
    const statusA = getCommitmentStatus(a).label;
    const statusB = getCommitmentStatus(b).label;

    const statusWeights = {
      "CRITICAL": 3,
      "CUTTING IT CLOSE": 2,
      "ON TRACK": 1,
      "LANDED": 0,
    };

    const weightA = statusWeights[statusA] || 0;
    const weightB = statusWeights[statusB] || 0;

    if (weightA !== weightB) {
      return weightB - weightA;
    }

    const startA = a.startByISO ? new Date(a.startByISO).getTime() : Infinity;
    const startB = b.startByISO ? new Date(b.startByISO).getTime() : Infinity;
    return startA - startB;
  });

  const sortedCompletedCommitments = [...completedCommitments].sort((a, b) => {
    const timeA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const timeB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return timeB - timeA;
  });

  const criticalCommitments = activeCommitments.filter((c) => getCommitmentStatus(c).label === "CRITICAL");
  const mostUrgentCritical = criticalCommitments.length > 0
    ? [...criticalCommitments].sort((a, b) => {
        const timeA = a.deadlineISO ? new Date(a.deadlineISO).getTime() : Infinity;
        const timeB = b.deadlineISO ? new Date(b.deadlineISO).getTime() : Infinity;
        return timeA - timeB;
      })[0]
    : null;

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-bg-deep text-zinc-300 font-sans flex items-center justify-center bg-radar-atmosphere">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Initializing Runway Systems...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg-deep text-zinc-300 font-sans flex flex-col justify-center items-center px-6 bg-radar-atmosphere selection:bg-zinc-800">
        <div className="w-full max-w-md p-8 border border-zinc-900 bg-surface-raised rounded-sm space-y-8 shadow-2xl relative overflow-hidden">
          {/* Subtle Radar Beacon Animation */}
          <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none">
            <div className="absolute top-4 right-4 w-2.5 h-2.5 bg-cyan-500 rounded-full animate-ping opacity-60"></div>
            <div className="absolute top-4 right-4 w-2.5 h-2.5 bg-cyan-400 rounded-full"></div>
          </div>

          <div className="text-center space-y-3">
            <h1 className="text-3xl font-display font-semibold text-zinc-100 tracking-tight">
              Runway
            </h1>
            <p className="font-mono text-xs text-cyan-400 uppercase tracking-widest font-medium">
              The Last-Minute Life Saver
            </p>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-sm mx-auto pt-2">
              An AI agent that helps you finish commitments before deadlines, not just remember them.
            </p>
          </div>

          <div className="border-t border-zinc-900/60 pt-6">
            <button
              onClick={handleSignInWithGoogle}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-sans text-sm font-semibold rounded-sm transition-all duration-150 shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-100 cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              <span>Sign in with Google</span>
            </button>
            {authError && (
              <p className="mt-4 text-center font-mono text-xs text-rose-400">
                {authError}
              </p>
            )}
          </div>

          <div className="text-center">
            <span className="font-mono text-[9px] text-zinc-600 uppercase tracking-widest">
              Secure Auth &bull; Gmail &amp; Calendar Required
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-deep text-zinc-300 font-sans selection:bg-zinc-800 bg-radar-atmosphere">
      <main className="max-w-2xl mx-auto px-6 py-16 md:py-24">
        <header className="mb-16 flex items-start justify-between">
          <div>
            <h1
              className="text-xl font-display font-medium text-zinc-100 tracking-tight cursor-pointer hover:text-white transition-colors"
              onClick={() => setView("dashboard")}
            >
              Runway
            </h1>
            <p className="font-mono text-xs text-zinc-500 mt-2 uppercase tracking-wider">
              The Last-Minute Life Saver
            </p>
          </div>
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="p-2 hover:bg-zinc-900 rounded-sm text-zinc-400 hover:text-cyan-400 transition-colors relative"
            title="User Profile Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </header>

        <AnimatePresence>
          {showProfile && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-8 border border-zinc-900 bg-surface-raised p-6 space-y-4 shadow-lg shadow-black/30 rounded-sm"
            >
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <span className="font-mono text-xs text-zinc-400 uppercase tracking-widest font-semibold">
                  User Profile (Known Identity)
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSignOut}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-red-400 hover:text-red-300 hover:bg-red-950/25 border border-zinc-900 hover:border-red-900/40 font-mono text-[10px] uppercase tracking-wider rounded-sm transition-all duration-150 shadow-sm cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Sign out</span>
                  </button>
                  <button
                    onClick={() => setShowProfile(false)}
                    className="text-zinc-500 hover:text-cyan-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="e.g. Anga Sai Girish"
                    className="w-full bg-transparent border-b border-zinc-900 pb-1 text-sm text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                    Email
                  </label>
                  <input
                    type="email"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    placeholder="e.g. user@gmail.com"
                    className="w-full bg-transparent border-b border-zinc-900 pb-1 text-sm text-zinc-400 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors font-mono cursor-not-allowed"
                    disabled
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                    Institute
                  </label>
                  <input
                    type="text"
                    value={profileInstitute}
                    onChange={(e) => setProfileInstitute(e.target.value)}
                    placeholder="e.g. IIT Guwahati"
                    className="w-full bg-transparent border-b border-zinc-900 pb-1 text-sm text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                    Grad Year
                  </label>
                  <input
                    type="text"
                    value={profileGradYear}
                    onChange={(e) => setProfileGradYear(e.target.value)}
                    placeholder="e.g. 2026"
                    className="w-full bg-transparent border-b border-zinc-900 pb-1 text-sm text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                  />
                  {!isPlausibleGradYear(profileGradYear) && (
                    <span className="text-red-400 font-mono text-[9px] block pt-1">
                      Please enter a plausible 4-digit year (e.g. 2026).
                    </span>
                  )}
                </div>
              </div>
              <p className="font-mono text-[9px] text-zinc-500 italic">
                Facts entered here will be used automatically to sign off drafts
                and ground your identity.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 1. HOME = The Runway Dashboard */}
        {view === "dashboard" && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-900 pb-4 gap-4">
              <h2 className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                The Runway
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="demo-inbox-checkbox"
                    checked={useDemoInbox}
                    onChange={(e) => setUseDemoInbox(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-900 bg-surface-raised text-cyan-500 focus:ring-cyan-500/30 focus:ring-offset-zinc-950 accent-cyan-500 cursor-pointer shadow-inner"
                  />
                  <label
                    htmlFor="demo-inbox-checkbox"
                    className="font-mono text-[10px] text-zinc-500 hover:text-cyan-400 cursor-pointer uppercase tracking-wider select-none transition-colors"
                  >
                    Use demo inbox
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleScanRadar}
                    disabled={scanningRadar}
                    className="flex items-center gap-2 px-4 py-2.5 bg-surface-raised hover:bg-zinc-900/40 border border-zinc-900 hover:border-cyan-500/30 text-zinc-400 hover:text-cyan-400 font-mono text-xs transition-all duration-150 rounded-sm disabled:opacity-50 shadow-md shadow-black/10"
                  >
                    {scanningRadar ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        <span>Scanning...</span>
                      </>
                    ) : (
                      <>
                        <Radio className="w-3.5 h-3.5 text-zinc-500 group-hover:text-cyan-400" />
                        <span>Scan inbox (Radar)</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setCommitment("");
                      setCleanTitle("");
                      setDeadline("");
                      setContext("");
                      setArchetype("");
                      setAgentReasoning("");
                      setDraftContent("");
                      setPhase("capture");
                      setStatus("idle");
                      setErrorMsg("");
                      setCurrentDraftDocId(null);
                      setView("new_commitment");
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-150 rounded-sm shadow-sm"
                  >
                    <span>+ New commitment</span>
                  </button>
                </div>
              </div>
            </div>

            {/* THE CRITICAL INTERCEPT */}
            {mostUrgentCritical && (
              <div className="border border-red-900/40 border-l-4 border-l-red-500 bg-surface-high p-6 space-y-4 shadow-2xl relative overflow-hidden rounded-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500/40 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500 shadow-[0_0_8px_#ef4444]"></span>
                      </span>
                      <h4 className="font-mono text-[10px] uppercase tracking-widest text-red-400 font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                        CRITICAL INTERCEPT
                      </h4>
                    </div>
                    <h3 className="font-display text-base sm:text-lg text-zinc-100 font-semibold tracking-tight">
                      CRITICAL: {mostUrgentCritical.title} is out of runway.
                    </h3>
                    <p className="text-zinc-400 font-mono text-[11px] leading-relaxed tracking-normal font-normal">
                      Less time remains than this task needs. Starting now is the only way to make it.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedCommitment(mostUrgentCritical);
                      setDeleteError(null);
                      setView("detail");
                    }}
                    className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors rounded-sm shadow-md"
                  >
                    <span>Start now - your draft is ready</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* PRE-FLIGHT BRIEFING PANEL */}
            {(!loadingCommitments || commitments.length > 0) && (
              <div className="border border-zinc-900 border-l-4 border-l-cyan-600/40 bg-surface-raised p-6 space-y-4 shadow-xl rounded-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-500/40 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500 shadow-[0_0_6px_#06b6d4]"></span>
                    </span>
                    <h3 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                      Pre-Flight Briefing
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      const activeList = commitments.filter((c) => c.completed !== true && c.status !== "draft");
                      fetchPreflightBriefing(activeList, true);
                    }}
                    disabled={loadingBriefing}
                    className="flex items-center gap-1.5 px-3 py-1 border border-zinc-800 bg-surface-high hover:border-cyan-500/30 text-zinc-500 hover:text-cyan-400 font-mono text-[9px] uppercase tracking-wider transition-colors disabled:opacity-50 rounded-sm shadow-sm"
                  >
                    {loadingBriefing ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-400" />
                    ) : (
                      <RefreshCw className="w-2.5 h-2.5" />
                    )}
                    <span>Refresh Briefing</span>
                  </button>
                </div>

                {loadingBriefing ? (
                  <div className="py-1 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
                    <span className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider animate-pulse">
                      Receiving controller transmission...
                    </span>
                  </div>
                ) : briefingError ? (
                  <div className="py-1 text-red-500 font-mono text-xs">
                    Transmission Error: {briefingError}
                  </div>
                ) : (
                  <div className="text-zinc-400 font-mono text-[11px] leading-relaxed tracking-normal font-normal whitespace-pre-wrap">
                    {briefingText || "No briefing transmitted. Use the action above to poll air-traffic control."}
                  </div>
                )}
              </div>
            )}

            {commitmentsError && (
              <div className="bg-rose-950/25 border border-rose-900/50 text-rose-400 font-mono text-xs rounded-sm p-4 mb-4">
                <span className="font-bold">Runway System Warning:</span> Failed to synchronize runway state. {commitmentsError}
              </div>
            )}

            {loadingCommitments ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
                <span className="font-mono text-xs text-zinc-500">
                  Scanning the runway...
                </span>
              </div>
            ) : commitments.length === 0 ? (
              <div className="border border-dashed border-zinc-800 rounded-sm p-12 text-center space-y-4">
                <p className="font-mono text-sm text-zinc-500">
                  The runway is clear. No active commitments.
                </p>
                <button
                  onClick={() => {
                    setCommitment("");
                    setCleanTitle("");
                    setDeadline("");
                    setContext("");
                    setArchetype("");
                    setAgentReasoning("");
                    setDraftContent("");
                    setPhase("capture");
                    setStatus("idle");
                    setErrorMsg("");
                    setCurrentDraftDocId(null);
                    setView("new_commitment");
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50 text-zinc-300 font-mono text-xs transition-colors rounded-sm"
                >
                  <span>Schedule First Domino</span>
                </button>
              </div>
            ) : sortedActiveCommitments.length === 0 ? (
              <div className="border border-dashed border-emerald-950/40 bg-emerald-950/5 rounded-sm p-12 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-emerald-950/20 border border-emerald-500/25 flex items-center justify-center text-emerald-500 mx-auto animate-pulse">
                  <Check className="w-5 h-5" />
                </div>
                <h3 className="font-sans text-sm text-zinc-300 font-medium">
                  Runway clear. All planes landed.
                </h3>
                <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider">
                  You've completed all commitments. Safe flight!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {sortedActiveCommitments.map((item) => {
                  const statusInfo = getCommitmentStatus(item);
                  const startByText = formatStartBy(item.startByISO);

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedCommitment(item);
                        setDeleteError(null);
                        setView("detail");
                      }}
                      className="group cursor-pointer border border-zinc-900 bg-surface-raised hover:bg-zinc-900/10 p-6 rounded-sm transition-all duration-150 hover:border-cyan-500/30 flex flex-col justify-between gap-5 shadow-lg shadow-black/20"
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <h3 className="text-zinc-50 font-display font-semibold text-base sm:text-lg group-hover:text-cyan-400 transition-colors leading-snug flex items-center gap-2">
                            {item.source === "radar" && (
                              <Radio className="w-3.5 h-3.5 text-rose-500 animate-pulse flex-shrink-0" title="Inbox Radar commitment" />
                            )}
                            <span>{item.title}</span>
                          </h3>
                          <span className="font-mono text-[9px] text-zinc-500 border border-zinc-900/80 px-2 py-0.5 rounded-sm uppercase tracking-widest bg-zinc-950/50 flex-shrink-0">
                            {item.archetype}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 border-t border-zinc-900/40 pt-3 text-[11px]">
                          <div className="space-y-1">
                            <span className="text-[10px] font-mono text-zinc-500 block uppercase tracking-wider">DEADLINE</span>
                            <span className="text-zinc-300 font-mono block font-medium">{item.deadline}</span>
                          </div>

                          {startByText && (
                            <div className="space-y-1">
                              <span className="text-[10px] font-mono text-zinc-500 block uppercase tracking-wider">START BY</span>
                              <span className="text-cyan-400/90 font-mono block font-medium">{startByText.replace("Start By: ", "")}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-zinc-900/60 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 px-2.5 py-1 border border-zinc-900 bg-zinc-950/40 font-mono text-[10px] rounded-sm">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              statusInfo.label === "ON TRACK" ? "bg-emerald-500 shadow-[0_0_6px_#10b981] animate-pulse" :
                              statusInfo.label === "CUTTING IT CLOSE" ? "bg-amber-500 shadow-[0_0_6px_#f59e0b] animate-pulse" :
                              statusInfo.label === "CRITICAL" ? "bg-red-500 shadow-[0_0_8px_#ef4444] animate-pulse" : "bg-zinc-600"
                            }`} />
                            <span className={`uppercase tracking-wider font-semibold ${
                              statusInfo.label === "ON TRACK" ? "text-emerald-400" :
                              statusInfo.label === "CUTTING IT CLOSE" ? "text-amber-400" :
                              statusInfo.label === "CRITICAL" ? "text-red-400" : "text-zinc-500"
                            }`}>
                              {statusInfo.label}
                            </span>
                          </div>
                          {(() => {
                            const countdown = getLiveCountdown(item, now);
                            if (!countdown) return null;
                            return (
                              <span className={countdown.textClass}>
                                {countdown.text}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 group-hover:text-cyan-400 transition-colors uppercase tracking-wider">
                          <span>View Domino</span>
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Drafts Section */}
            {draftCommitments.length > 0 && (
              <div className="pt-6 border-t border-zinc-900 mt-12 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500 shadow-[0_0_6px_#f59e0b]"></span>
                  </span>
                  <h3 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                    Drafts ({draftCommitments.length})
                  </h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {draftCommitments.map((item) => (
                    <div
                      key={item.id}
                      className="group relative border border-dashed border-zinc-800 bg-surface-raised hover:bg-zinc-900/10 p-5 rounded-sm transition-all duration-150 hover:border-yellow-500/30 flex flex-col justify-between gap-4 shadow-md"
                    >
                      {confirmingDeleteDraftId === item.id ? (
                        <div className="flex flex-col items-center justify-center py-6 text-center space-y-4 bg-zinc-950/20 rounded-sm w-full">
                          <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">
                            Discard this draft commitment?
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleDeleteDraftConfirm(item)}
                              className="px-3 py-1 bg-rose-950/40 border border-rose-900/50 hover:bg-rose-900 hover:text-zinc-50 text-rose-400 font-mono text-[9px] uppercase tracking-wider rounded-sm transition-colors"
                            >
                              Confirm Discard
                            </button>
                            <button
                              onClick={() => setConfirmingDeleteDraftId(null)}
                              className="px-3 py-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 font-mono text-[9px] uppercase tracking-wider rounded-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div 
                            onClick={() => handleResumeDraft(item)}
                            className="space-y-3 cursor-pointer flex-grow"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <h4 className="text-zinc-200 font-sans font-medium text-sm sm:text-base group-hover:text-yellow-400 transition-colors leading-snug">
                                {item.title}
                              </h4>
                              <span className="font-mono text-[8px] text-zinc-500 border border-zinc-900/80 px-1.5 py-0.5 rounded-sm uppercase tracking-widest bg-zinc-950/50 flex-shrink-0">
                                {item.archetype}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-zinc-500 leading-relaxed line-clamp-2">
                              {item.originalCommitment}
                            </p>
                            <div className="text-[10px] font-mono text-zinc-500 pt-1">
                              <span>Deadline: </span>
                              <span className="text-zinc-400">{item.deadline}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-zinc-900/40">
                            <button
                              onClick={() => handleResumeDraft(item)}
                              className="font-mono text-[10px] text-zinc-400 group-hover:text-yellow-400 flex items-center gap-1 uppercase tracking-wider transition-colors"
                            >
                              <span>Resume</span>
                              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                            <button
                              onClick={() => setConfirmingDeleteDraftId(item.id)}
                              className="font-mono text-[10px] text-rose-500/70 hover:text-rose-400 flex items-center gap-1 uppercase tracking-wider transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Discard</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed commitments section */}
            {sortedCompletedCommitments.length > 0 && (
              <div className="pt-6 border-t border-zinc-900 mt-12 space-y-4">
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 text-zinc-500 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors focus:outline-none"
                >
                  <span>Landed ({sortedCompletedCommitments.length})</span>
                  <span className="text-[9px] opacity-75">{showCompleted ? "▲" : "▼"}</span>
                </button>

                {showCompleted && (
                  <div className="grid grid-cols-1 gap-4">
                    {sortedCompletedCommitments.map((item) => {
                      const completedDateStr = item.completedAt 
                        ? new Date(item.completedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "recently";

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            setSelectedCommitment(item);
                            setDeleteError(null);
                            setView("detail");
                          }}
                          className="group cursor-pointer border border-zinc-900 bg-surface-raised hover:bg-zinc-900/10 p-5 rounded-sm transition-all duration-150 hover:border-cyan-500/20 flex flex-col justify-between gap-4 opacity-60 hover:opacity-100 shadow-md shadow-black/10"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <h3 className="text-zinc-400 font-display text-sm group-hover:text-cyan-400 transition-colors leading-snug line-through">
                              {item.title}
                            </h3>
                            <span className="font-mono text-[9px] text-zinc-600 border border-zinc-900 px-2 py-0.5 rounded-sm uppercase tracking-widest bg-zinc-950/50 flex-shrink-0">
                              {item.archetype}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                            <span>LANDED: {completedDateStr.toUpperCase()}</span>
                            <div className="flex items-center gap-2 px-2.5 py-1 border border-zinc-900 bg-zinc-950/40 font-mono text-[10px] rounded-sm">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                              <span className="uppercase tracking-wider font-semibold text-zinc-500">
                                LANDED
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Radar Scan Results Panel */}
            {(radarCandidates !== null || scanningRadar || radarError) && (
              <div className="border border-zinc-800 bg-zinc-950/20 rounded-sm p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Radio className={`w-4 h-4 text-rose-500 ${scanningRadar ? 'animate-pulse' : ''}`} />
                      {scanningRadar && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full animate-ping" />
                      )}
                    </div>
                    <h3 className="font-mono text-xs text-zinc-300 font-semibold uppercase tracking-wider">
                      The Radar — Inbox Scan
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {radarCandidates !== null && !scanningRadar && (
                      <button
                        onClick={handleScanRadar}
                        className="text-zinc-500 hover:text-zinc-300 font-mono text-[10px] uppercase tracking-wider flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Re-scan
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setRadarCandidates(null);
                        setRadarError(null);
                      }}
                      className="text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {scanningRadar ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-rose-500/80" />
                    <span className="font-mono text-xs text-zinc-400">
                      Reading Gmail & extracting commitments with AI...
                    </span>
                    <span className="font-mono text-[9px] text-zinc-600 uppercase">
                      Analyzing latest messages
                    </span>
                  </div>
                ) : radarError ? (
                  <div className="p-4 border border-rose-950/40 bg-rose-950/5 text-rose-400 font-mono text-xs rounded-sm space-y-2">
                    <p>Scan Error: {radarError}</p>
                    <button
                      onClick={handleScanRadar}
                      className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-sm transition-colors text-[10px]"
                    >
                      Retry
                    </button>
                  </div>
                ) : radarCandidates !== null && radarCandidates.length === 0 ? (
                  <div className="py-8 text-center border border-dashed border-zinc-900 rounded-sm">
                    <p className="font-mono text-xs text-zinc-500">
                      Radar clean. No actionable commitments found in your recent emails.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                      <span>{radarCandidates?.length} Actionable Candidates Found</span>
                      <span className="text-rose-500/80 animate-pulse">● Live Scan</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {radarCandidates?.map((cand: any, idx: number) => {
                        const key = cand.emailId || String(idx);
                        const currentTitle = candidateTitles[key] !== undefined ? candidateTitles[key] : cand.title;
                        const currentDeadline = candidateDeadlines[key] !== undefined ? candidateDeadlines[key] : cand.deadline;
                        const isProcessing = processingCandidateId === key;

                        return (
                          <div
                            key={key}
                            className="border border-zinc-900 bg-zinc-900/5 p-4 rounded-sm space-y-3 relative group overflow-hidden"
                          >
                            <div className="absolute top-0 left-0 right-0 h-[1px] bg-rose-500/20" />
                            
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 space-y-1">
                                  <label className="block text-[9px] font-mono uppercase tracking-wider text-zinc-600">Commitment</label>
                                  <input
                                    type="text"
                                    value={currentTitle}
                                    onChange={(e) => {
                                      setCandidateTitles((prev) => ({ ...prev, [key]: e.target.value }));
                                    }}
                                    disabled={isProcessing}
                                    className="w-full bg-transparent border-b border-zinc-900 text-zinc-200 text-sm focus:outline-none focus:border-zinc-700 pb-0.5 disabled:opacity-50"
                                  />
                                </div>
                                <span className="font-mono text-[8px] text-rose-400 border border-rose-950/40 px-1.5 py-0.5 rounded bg-rose-950/10 flex-shrink-0 tracking-wider self-start">
                                  UNADDED
                                </span>
                              </div>
                              
                              <div className="space-y-2">
                                <div className="text-[11px] text-zinc-500 font-mono">
                                  <span className="truncate block">From: {cand.sender}</span>
                                </div>
                                <div className="space-y-1">
                                  <label className="block text-[9px] font-mono uppercase tracking-wider text-zinc-600">Deadline</label>
                                  <input
                                    type="text"
                                    value={currentDeadline}
                                    onChange={(e) => {
                                      setCandidateDeadlines((prev) => ({ ...prev, [key]: e.target.value }));
                                    }}
                                    placeholder="e.g. tomorrow 5pm"
                                    disabled={isProcessing}
                                    className="w-full bg-transparent border-b border-zinc-900 text-zinc-300 text-xs font-mono focus:outline-none focus:border-zinc-700 pb-0.5 disabled:opacity-50"
                                  />
                                </div>
                              </div>
                            </div>
                            
                            <div className="pt-2 border-t border-zinc-900/40 text-[11px] text-zinc-400 leading-relaxed italic">
                              <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider block not-italic mb-0.5">Reason Flagged</span>
                              "{cand.reason}"
                            </div>

                            {showNamePrompt && (!profileName || !profileName.trim()) && (
                              <div className="text-[10px] text-yellow-400 font-mono bg-yellow-950/20 border border-yellow-900/20 px-2.5 py-1.5 rounded-sm">
                                Please fill in your name under User Profile settings (signatures depend on it).
                              </div>
                            )}

                            {candidateErrors[key] && (
                              <div className="text-[10px] text-rose-400 font-mono bg-rose-950/20 border border-rose-900/20 px-2.5 py-1.5 rounded-sm">
                                {candidateErrors[key]}
                              </div>
                            )}

                            <div className="pt-2 flex justify-end">
                              <button
                                onClick={() => handleAddCandidate(cand, idx)}
                                disabled={processingCandidateId !== null}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/25 hover:bg-rose-950/45 border border-rose-900/40 hover:border-rose-900/80 text-rose-300 font-mono text-[10px] font-semibold transition-all rounded-sm disabled:opacity-50 flex-shrink-0"
                              >
                                {isProcessing ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin text-rose-400" />
                                    <span>Adding...</span>
                                  </>
                                ) : (
                                  <>
                                    <span>Add to Runway</span>
                                    <ArrowRight className="w-3 h-3" />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] font-mono text-zinc-500 text-center pt-2">
                      Candidates are detected from your inbox. Add them to the Runway by clicking "Add to Runway".
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 2. Saved Commitment Detail View */}
        {view === "detail" && selectedCommitment && (
          <div className="space-y-8">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
              <button
                onClick={() => {
                  setSelectedCommitment(null);
                  setDeleteError(null);
                  setView("dashboard");
                }}
                className="flex items-center gap-1.5 text-zinc-500 hover:text-cyan-400 font-mono text-xs transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Runway</span>
              </button>
              <div className="flex items-center gap-3">
                {(() => {
                  const statusInfo = getCommitmentStatus(selectedCommitment);
                  return (
                    <div className="flex items-center gap-2 px-2.5 py-1 border border-zinc-900 bg-zinc-950/40 font-mono text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        statusInfo.label === "ON TRACK" ? "bg-emerald-500 animate-pulse" :
                        statusInfo.label === "CUTTING IT CLOSE" ? "bg-amber-500 animate-pulse" :
                        statusInfo.label === "CRITICAL" ? "bg-red-500 animate-pulse" : "bg-zinc-600"
                      }`} />
                      <span className={`uppercase tracking-wider font-semibold ${
                        statusInfo.label === "ON TRACK" ? "text-emerald-400" :
                        statusInfo.label === "CUTTING IT CLOSE" ? "text-amber-400" :
                        statusInfo.label === "CRITICAL" ? "text-red-400" : "text-zinc-500"
                      }`}>
                        {statusInfo.label}
                      </span>
                    </div>
                  );
                })()}
                <span className="font-mono text-[9px] text-zinc-500 border border-zinc-900 px-2 py-1 rounded-sm uppercase tracking-widest bg-zinc-950/50">
                  {selectedCommitment.archetype}
                </span>
              </div>
            </div>

            {deleteError && (
              <div className="p-4 border border-rose-900/50 bg-rose-950/10 rounded-sm space-y-1">
                <h4 className="font-mono text-[10px] text-rose-500 uppercase tracking-wider font-bold">
                  Deletion Transmission Failed
                </h4>
                <p className="text-zinc-300 text-xs">
                  {deleteError}
                </p>
              </div>
            )}

            {landedSuccess ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-emerald-950/30 border border-emerald-500/50 flex items-center justify-center text-emerald-400 animate-pulse">
                  <Check className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-sans text-2xl text-zinc-100 font-semibold tracking-tight">
                    Landed.
                  </h3>
                  <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                    Plane has cleared the runway. Focus secured.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
              <div className="p-6 border border-zinc-900 bg-surface-raised rounded-sm space-y-4 shadow-lg shadow-black/20">
                <h2 className="text-zinc-50 font-display font-semibold text-xl sm:text-2xl tracking-tight leading-snug">
                  {selectedCommitment.title}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-zinc-900/40 text-xs">
                  <div>
                    <span className="font-mono text-[9px] text-zinc-500 uppercase block mb-1 tracking-wider">
                      DEADLINE
                    </span>
                    <span className="text-zinc-300 font-mono font-medium">
                      {selectedCommitment.deadline}
                    </span>
                  </div>
                  {selectedCommitment.startByISO && (
                    <div>
                      <span className="font-mono text-[9px] text-zinc-500 uppercase block mb-1 tracking-wider">
                        START BY
                      </span>
                      <span className="text-cyan-400 font-mono font-medium">
                        {new Date(selectedCommitment.startByISO).toLocaleDateString(
                          undefined,
                          {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="font-mono text-[9px] text-zinc-500 uppercase block mb-1 tracking-wider">
                      CREATED
                    </span>
                    <span className="text-zinc-400 font-mono">
                      {new Date(selectedCommitment.createdAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </span>
                  </div>
                </div>

                {selectedCommitment.startByISO && (
                  <div className="pt-4 border-t border-zinc-900/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex-1">
                      {defendError && (
                        <span className="text-xs text-rose-400 font-mono block">
                          Error: {defendError}
                        </span>
                      )}
                    </div>
                    {selectedCommitment.defended ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-cyan-950 bg-cyan-950/20 text-cyan-400 font-mono text-[10px] uppercase tracking-wider">
                        <Check className="w-3.5 h-3.5" />
                        Airspace Defended
                      </span>
                    ) : (
                      <button
                        onClick={handleDefendSlot}
                        disabled={defending}
                        className="px-4 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 text-zinc-300 hover:text-cyan-400 font-mono text-[10px] uppercase tracking-wider transition-colors rounded-sm disabled:opacity-50 flex items-center gap-1.5 self-end"
                      >
                        {defending ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                            Defending...
                          </>
                        ) : (
                          "Defend this time"
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {selectedCommitment.completed && (
                <div className="bg-emerald-950/15 border border-emerald-900/40 p-5 rounded-sm flex items-start gap-4 shadow-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0 shadow-[0_0_5px_#10b981]" />
                  <div className="space-y-1">
                    <h3 className="font-mono text-[10px] text-emerald-400 uppercase tracking-widest font-bold font-semibold">
                      Post-Completion Reflection
                    </h3>
                    <p className="text-xs sm:text-[13px] text-zinc-300 leading-relaxed font-mono">
                      {selectedCommitment.reflection || computeReflection(selectedCommitment)}
                    </p>
                    {selectedCommitment.completedAt && (
                      <span className="text-[10px] text-zinc-500 font-mono block">
                        LANDED AT: {new Date(selectedCommitment.completedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {selectedCommitment.reasoningTrace && (
                <div className="bg-surface-raised border border-zinc-900 p-5 rounded-sm flex items-start gap-4 shadow-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5 flex-shrink-0 shadow-[0_0_5px_#06b6d4]" />
                  <div>
                    <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-1 font-bold">
                      Agent Reasoning
                    </h3>
                    <p className="text-xs sm:text-[13px] text-zinc-400 leading-relaxed font-mono">
                      {selectedCommitment.reasoningTrace}
                    </p>
                  </div>
                </div>
              )}

              <div className="p-6 sm:p-8 border border-zinc-900 rounded-sm bg-surface-raised space-y-6 shadow-lg shadow-black/20">
                <div className="w-full text-zinc-300 font-sans leading-relaxed tracking-normal text-sm sm:text-base whitespace-pre-wrap">
                  {selectedCommitment.approvedArtifact}
                </div>

                {/* Gmail Draft integration for email-type commitments */}
                {(selectedCommitment.archetype === "Inbound Inquiry" || selectedCommitment.archetype === "Job Application") && (
                  <div className="pt-6 border-t border-zinc-900/60 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-cyan-500" />
                      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
                        Gmail Dispatcher
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex-1 flex items-center gap-2 border border-zinc-900 bg-zinc-950/40 px-3 py-2 rounded-sm focus-within:border-cyan-500/50 transition-colors">
                        <span className="font-mono text-xs text-zinc-500 select-none w-8">To:</span>
                        <input
                          type="text"
                          value={toRecipient}
                          onChange={(e) => setToRecipient(e.target.value)}
                          placeholder="recipient@example.com (optional)"
                          className="w-full bg-transparent text-zinc-200 text-xs placeholder:text-zinc-800 focus:outline-none font-mono"
                        />
                      </div>

                      {selectedCommitment.gmailDraftCreated ? (
                        <div className="flex items-center gap-1.5 px-4 py-2 border border-emerald-900 bg-emerald-950/10 text-emerald-400 font-mono text-[11px] uppercase tracking-wider rounded-sm select-none">
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>Draft saved to Gmail</span>
                        </div>
                      ) : (
                        <button
                          onClick={handleSaveGmailDraft}
                          disabled={savingDraft}
                          className="px-5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 text-zinc-300 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap self-stretch sm:self-auto justify-center"
                        >
                          {savingDraft ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              <span>Saving...</span>
                            </>
                          ) : (
                            <span>Save to Gmail as draft</span>
                          )}
                        </button>
                      )}
                    </div>

                    {draftError && (
                      <span className="text-xs text-rose-400 font-mono block">
                        {draftError}
                      </span>
                    )}

                    {detailActionError && (
                      <div className="text-[10px] text-rose-400 font-mono bg-rose-950/20 border border-rose-900/20 px-2.5 py-1.5 rounded-sm mt-2">
                        Action Error: {detailActionError}
                      </div>
                    )}

                    {deleteError && (
                      <div className="text-[10px] text-rose-400 font-mono bg-rose-950/20 border border-rose-900/20 px-2.5 py-1.5 rounded-sm mt-2">
                        Delete Error: {deleteError}
                      </div>
                    )}

                    {selectedCommitment.gmailDraftCreated && (
                      <p className="text-[11px] text-zinc-500 font-mono italic">
                        Real unsent draft created. You can find it in your Gmail drafts folder to review and send.
                      </p>
                    )}
                  </div>
                )}

                {/* Google Tasks integration for Actionable Task archetype */}
                {selectedCommitment.archetype === "Actionable Task" && (
                  <div className="pt-6 border-t border-zinc-900/60 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-1 rounded-full bg-cyan-500" />
                      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest font-bold">
                        Google Tasks Synchronizer
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {selectedCommitment.googleTasksAdded ? (
                        <div className="flex items-center gap-1.5 px-4 py-2 border border-emerald-900 bg-emerald-950/10 text-emerald-400 font-mono text-[11px] uppercase tracking-wider rounded-sm select-none">
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span>Added to Google Tasks</span>
                        </div>
                      ) : (
                        <button
                          onClick={handleAddToGoogleTasks}
                          disabled={addingToTasks}
                          className="px-5 py-2 bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 text-zinc-300 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap self-stretch sm:self-auto justify-center"
                        >
                          {addingToTasks ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              <span>Adding to Tasks...</span>
                            </>
                          ) : (
                            <span>Add to Google Tasks</span>
                          )}
                        </button>
                      )}
                    </div>

                    {tasksError && (
                      <span className="text-xs text-rose-400 font-mono block">
                        {tasksError}
                      </span>
                    )}
                  </div>
                )}

                <div className="pt-6 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {!selectedCommitment.completed && (
                      <button
                        onClick={async () => {
                          const targetDocId = selectedCommitment.docId;
                          setCompleting(true);
                          setDetailActionError(null);
                          try {
                            if (!targetDocId) {
                              throw new Error("No commitment ID found.");
                            }
                            const completedAt = new Date().toISOString();
                            const reflection = computeReflection({
                              ...selectedCommitment,
                              completedAt,
                            });
                            const updated = {
                              ...selectedCommitment,
                              completed: true,
                              completedAt,
                              reflection
                            };
                            await setDoc(doc(db, "commitments", targetDocId), updated);
                            setCommitments(prev => {
                              const newList = prev.map(c => c.docId === targetDocId ? updated : c);
                              const activeList = newList.filter(c => c.completed !== true && c.status !== "draft");
                              fetchPreflightBriefing(activeList);
                              return newList;
                            });
                            setSelectedCommitment(updated);
                            setLandedSuccess(true);
                            setTimeout(() => {
                              setLandedSuccess(false);
                              setSelectedCommitment(null);
                              setView("dashboard");
                            }, 1800);
                          } catch (err: any) {
                            console.error("Failed to mark as done:", err);
                            setDetailActionError(err.message || "Failed to complete commitment in database.");
                            try {
                              handleFirestoreError(err, OperationType.WRITE, `commitments/${targetDocId}`);
                            } catch (_) {}
                          } finally {
                            setCompleting(false);
                          }
                        }}
                        disabled={completing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider transition-colors rounded-sm shadow-sm"
                      >
                        {completing ? (
                          <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        <span>{completing ? "Landed..." : "Mark as Done"}</span>
                      </button>
                    )}

                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            selectedCommitment.approvedArtifact,
                          );
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch (e) {
                          console.error("Failed to copy", e);
                        }
                      }}
                      className="flex items-center gap-2 px-5 py-2.5 bg-surface-high hover:bg-zinc-900/60 border border-zinc-900 text-zinc-300 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm shadow-sm"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      {copied ? "Copied" : "Copy to Clipboard"}
                    </button>
                  </div>

                  {confirmingDelete ? (
                    <div className="flex items-center gap-4 bg-surface-high p-4 border border-zinc-900 rounded-sm shadow-md">
                      <span className="text-xs font-mono text-zinc-400">
                        Delete this commitment? This cannot be undone.
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            setDeleteError(null);
                            const targetDocId = selectedCommitment?.docId;
                            try {
                              if (!targetDocId) {
                                throw new Error("No commitment ID found.");
                              }
                              await deleteDoc(
                                doc(db, "commitments", targetDocId),
                              );
                              setCommitments((prev) => {
                                const newList = prev.filter((c) => c.docId !== targetDocId);
                                const activeList = newList.filter(c => c.completed !== true && c.status !== "draft");
                                fetchPreflightBriefing(activeList);
                                return newList;
                              });
                              setSelectedCommitment(null);
                              setView("dashboard");
                            } catch (err: any) {
                              console.error("Failed to delete from Firestore with docId:", targetDocId, err);
                              setDeleteError(err.message || "Failed to delete commitment.");
                              handleFirestoreError(err, OperationType.DELETE, `commitments/${targetDocId}`);
                            }
                          }}
                          className="px-3 py-1.5 bg-red-950/20 border border-red-900/50 hover:bg-red-900/40 text-red-400 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      className="text-zinc-500 hover:text-red-500 text-xs font-mono uppercase tracking-widest transition-colors"
                    >
                      Delete commitment
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          </div>
        )}

        {/* 3. New Commitment Creation Flow */}
        {view === "new_commitment" && (
          <div className="space-y-8">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
              <button
                onClick={() => {
                  setStatus("idle");
                  setPhase("capture");
                  setCurrentDraftDocId(null);
                  setView("dashboard");
                }}
                className="flex items-center gap-1.5 text-zinc-500 hover:text-cyan-400 font-mono text-xs transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Cancel</span>
              </button>
              <span className="font-mono text-xs text-zinc-400 uppercase tracking-widest">
                New Commitment
              </span>
            </div>

            {(status === "idle" ||
              status === "drafting" ||
              status === "error") && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-12"
              >
                {phase === "capture" ? (
                  /* Phase 1 - Capture */
                  <div className="space-y-6">
                    <div className="p-6 border border-zinc-900 bg-surface-raised rounded-sm space-y-4 shadow-lg shadow-black/20">
                      <div className="space-y-2">
                        <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          Commitment
                        </label>
                        <textarea
                          value={commitment}
                          onChange={(e) => setCommitment(e.target.value)}
                          placeholder="e.g. Apply to the SingleStore Cloud Foundations role by Friday"
                          rows={2}
                          className="w-full bg-transparent border-b border-zinc-900 pb-2 text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors resize-none font-sans"
                        />
                      </div>
                      <div className="space-y-2 pt-2">
                        <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          Deadline
                        </label>
                        <input
                          type="text"
                          value={deadline}
                          onChange={(e) => setDeadline(e.target.value)}
                          placeholder="e.g. Friday 5pm"
                          className="w-full bg-transparent border-b border-zinc-900 pb-2 text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                        />
                      </div>
                    </div>

                    {errorMsg && (
                      <div className="text-red-400 font-mono text-xs p-4 bg-red-950/20 border border-red-900/50 rounded-sm">
                        {errorMsg}
                      </div>
                    )}

                    <button
                      onClick={handleContinue}
                      disabled={classifying}
                      className="group flex items-center justify-between w-full p-4 border border-zinc-900 hover:border-cyan-500/30 bg-surface-raised hover:bg-zinc-900/40 transition-all font-mono text-xs text-zinc-400 hover:text-cyan-400 uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed rounded-sm shadow-md"
                    >
                      <span>
                        {classifying ? "Analyzing commitment..." : "Continue"}
                      </span>
                      {classifying ? (
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      ) : (
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      )}
                    </button>
                  </div>
                ) : (
                  /* Phase 2 - Targeted Context */
                  <div className="space-y-8">
                    {/* Detected Archetype Bar */}
                    <div className="flex items-center justify-between p-3.5 bg-surface-raised border border-zinc-900 rounded-sm shadow-md">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_6px_#06b6d4]" />
                        <span className="font-mono text-xs text-zinc-400">
                          Detected:{" "}
                          <strong className="text-cyan-400">{archetype}</strong>
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setPhase("capture");
                          setErrorMsg("");
                        }}
                        className="font-mono text-[10px] text-zinc-500 hover:text-cyan-400 transition-colors uppercase tracking-widest"
                      >
                        Back
                      </button>
                    </div>

                    {/* Conditional Fields based on Archetype */}
                    {archetype === "Job Application" && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                            Job Description (Optional)
                          </label>
                          <textarea
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            placeholder="Paste snippets or the full job description here..."
                            rows={3}
                            className="w-full bg-surface-raised border border-zinc-900 p-3 text-sm text-zinc-200 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors resize-none font-sans rounded-sm shadow-inner"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                              Resumes
                            </label>
                            <div className="flex items-center gap-4">
                              <button
                                onClick={loadSamples}
                                className="font-mono text-[10px] text-zinc-500 hover:text-cyan-400 transition-colors flex items-center gap-1"
                              >
                                <FileText className="w-3 h-3" />
                                Load sample resumes
                              </button>
                              <button
                                onClick={() => setUseTextFallback(!useTextFallback)}
                                className="font-mono text-[10px] text-zinc-500 hover:text-cyan-400 transition-colors"
                              >
                                {useTextFallback
                                  ? "Use PDF upload instead"
                                  : "Paste resume text instead"}
                              </button>
                            </div>
                          </div>

                          {useTextFallback ? (
                            <textarea
                              value={resumeText}
                              onChange={(e) => setResumeText(e.target.value)}
                              placeholder="Paste your resume text here..."
                              rows={6}
                              className="w-full bg-surface-raised border border-zinc-900 p-3 text-sm text-zinc-300 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500 transition-colors resize-y font-mono rounded-sm shadow-inner"
                            />
                          ) : (
                            <div className="space-y-3">
                              <div
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full border border-dashed border-zinc-900 bg-surface-raised hover:border-cyan-500/30 hover:bg-zinc-900/10 transition-colors rounded-sm p-6 flex flex-col items-center justify-center gap-2 cursor-pointer group shadow-sm"
                              >
                                <UploadCloud className="w-5 h-5 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                                <span className="font-mono text-xs text-zinc-400 group-hover:text-cyan-400 transition-colors">
                                  Click to upload PDF resumes
                                </span>
                              </div>
                              <input
                                type="file"
                                multiple
                                accept="application/pdf"
                                className="hidden"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                              />

                              {resumeFiles.length > 0 && (
                                <ul className="space-y-2">
                                  {resumeFiles.map((f) => (
                                    <li
                                      key={f.id}
                                      className="flex items-center justify-between p-2.5 bg-surface-raised border border-zinc-900 rounded-sm shadow-sm"
                                    >
                                      <span className="font-mono text-xs text-zinc-300 truncate mr-4">
                                        {f.name}
                                      </span>
                                      <button
                                        onClick={() => removeFile(f.id)}
                                        className="text-zinc-500 hover:text-red-400 transition-colors"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {archetype === "Inbound Inquiry" && (
                      <div className="space-y-2">
                        <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          Paste the email you are replying to
                        </label>
                        <textarea
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          placeholder="Paste the sender's email here..."
                          rows={6}
                          className="w-full bg-surface-raised border border-zinc-900 p-3 text-sm text-zinc-300 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500/50 transition-colors resize-y font-mono rounded-sm shadow-inner"
                        />
                      </div>
                    )}

                    {archetype === "Long-form Writing" && (
                      <div className="space-y-2">
                        <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          Topic / brief / any source notes (Optional)
                        </label>
                        <textarea
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          placeholder="Provide the core topic, outline instructions, or background notes..."
                          rows={6}
                          className="w-full bg-surface-raised border border-zinc-900 p-3 text-sm text-zinc-300 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500/50 transition-colors resize-y font-mono rounded-sm shadow-inner"
                        />
                      </div>
                    )}

                    {archetype === "Actionable Task" && (
                      <div className="space-y-2">
                        <label className="block font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                          Any details (Optional)
                        </label>
                        <textarea
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          placeholder="Provide any additional constraints, specs, or task context..."
                          rows={6}
                          className="w-full bg-surface-raised border border-zinc-900 p-3 text-sm text-zinc-300 placeholder:text-zinc-800 focus:outline-none focus:border-cyan-500/50 transition-colors resize-y font-mono rounded-sm shadow-inner"
                        />
                      </div>
                    )}

                    {showNamePrompt && (!profileName || !profileName.trim()) && (
                      <div className="text-yellow-400 font-mono text-xs p-4 bg-yellow-950/20 border border-yellow-900/50 rounded-sm">
                        Please fill in your name under User Profile settings (signatures depend on it).
                      </div>
                    )}

                    {errorMsg && (
                      <div className="text-red-400 font-mono text-xs p-4 bg-red-950/20 border border-red-900/50 rounded-sm">
                        {errorMsg}
                      </div>
                    )}

                    <button
                      onClick={handleDraft}
                      disabled={status === "drafting"}
                      className="group flex items-center justify-between w-full p-4 border border-zinc-900 hover:border-cyan-500/30 bg-surface-raised hover:bg-zinc-900/40 transition-all font-mono text-xs text-zinc-400 hover:text-cyan-400 uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed rounded-sm shadow-md"
                    >
                      <span>
                        {status === "drafting"
                          ? "Agent is drafting..."
                          : "Draft my first domino"}
                      </span>
                      {status === "drafting" ? (
                        <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      ) : (
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {/* Results View */}
            <AnimatePresence>
              {(status === "review" || status === "approved") && (
                <motion.div
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  className="space-y-8 animate-none"
                >
                  <div className="bg-surface-raised border border-zinc-900 p-5 rounded-sm flex items-start gap-4 shadow-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-1.5 flex-shrink-0 shadow-[0_0_5px_#06b6d4]" />
                    <div>
                      <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest mb-1 font-bold">
                        Agent Reasoning
                      </h3>
                      <p className="text-xs sm:text-[13px] text-zinc-400 leading-relaxed font-mono">
                        {agentReasoning}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="p-6 sm:p-8 border border-zinc-900 rounded-sm bg-surface-raised space-y-4 shadow-lg shadow-black/20">
                      {status === "review" ? (
                        <textarea
                          ref={textareaRef}
                          value={draftContent}
                          onChange={(e) => setDraftContent(e.target.value)}
                          className="w-full bg-transparent text-zinc-200 font-sans leading-relaxed tracking-normal text-sm sm:text-base min-h-[400px] placeholder:text-zinc-800 focus:outline-none resize-none overflow-hidden"
                          placeholder="Awaiting draft..."
                        />
                      ) : (
                        <div className="w-full text-zinc-300 font-sans leading-relaxed tracking-normal text-sm sm:text-base whitespace-pre-wrap">
                          {draftContent}
                        </div>
                      )}
                    </div>

                    <div className="pt-8 border-t border-zinc-900 flex items-center justify-between">
                      {status === "review" ? (
                        <>
                          <button
                            onClick={handleApprove}
                            className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-mono text-xs font-bold uppercase tracking-wider transition-colors rounded-sm shadow-sm"
                          >
                            Approve
                          </button>
                          <button
                            onClick={handleDraft}
                            className="flex items-center gap-2 px-4 py-2.5 text-zinc-500 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Regenerate
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleCopy}
                            className="flex items-center gap-2 px-5 py-2.5 bg-surface-high hover:bg-zinc-900/60 border border-zinc-900 text-zinc-300 font-mono text-xs uppercase tracking-wider transition-colors rounded-sm shadow-sm"
                          >
                            {copied ? (
                              <Check className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                            {copied ? "Copied" : "Copy to Clipboard"}
                          </button>
                          <button
                            onClick={() => {
                              setStatus("idle");
                              setPhase("capture");
                              setView("dashboard");
                            }}
                            className="text-zinc-500 hover:text-cyan-400 font-mono text-xs uppercase tracking-wider transition-colors"
                          >
                            Back to Runway
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
