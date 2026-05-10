import React, { useState, useEffect, useRef } from "react";
import StudioNodeEditor from "./components/StudioNodeEditor";
import { AppContext } from "./context/AppContext";
import {
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
  Navigate,
} from "react-router-dom";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { auth, db, storage } from "./firebase";
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  deleteDoc,
  updateDoc,
  addDoc,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL, uploadBytes } from "firebase/storage";
import { Camera, Layers, Video, Download, Upload, Plus, AlertCircle, RefreshCcw, Film, X, CheckCircle2, Zap, Image as ImageIcon, Type as TypeIcon, Layout, ArrowRight, RotateCcw, Play, Pause, Volume2, VolumeX, Settings, Key, ExternalLink, Sparkles, Wand2, Table as TableIcon, Loader2, Globe, Clock, Trash2, FolderOpen, FolderPlus, Folder, Library, List, Maximize2 } from "lucide-react";
import { OperationType, handleFirestoreError } from "./firebaseErrors";

/**
 * GENER8 - ULTRA-PREMIUM AI FILMMAKING PORTAL
 * Orchestration Engine: Gemini 3.1 Pro / Veo 3.1
 * Imaging Engine: Gemini 2.5 Flash Image
 */

import { useAppStore } from "./store/useAppStore";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const App = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive activeTab from URL path
  const activeTab = location.pathname.split("/")[1] || "images";

  // --- State Management ---
  const { user, setUser, updateCredits, history, setHistory, addHistoryItem } =
    useAppStore();
  const [authMode, setAuthMode] = useState<"login" | "app">("login");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const authFetch = async (url: string, options: RequestInit = {}) => {
    let token = "";
    if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
    }
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      setUser(null);
      setAuthMode("login");
      throw new Error("Session expired");
    }
    return res;
  };

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setAuthMode("app");

        // Fetch User / Ensure they exist in Firestore
        const userRef = doc(db, "users", firebaseUser.uid);
        onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            setUser({
              id: firebaseUser.uid,
              email: firebaseUser.email || "",
              ...docSnap.data(),
            } as any);
          } else {
            // Create initial user
            const defaultUser = {
              email: firebaseUser.email || "",
              credits: 100,
              monthly_allowance: 100,
              tier: "Standard",
              role: firebaseUser.email === "admin@gener8.ai" ? "admin" : "user",
              last_reset_date: new Date().toISOString().substring(0, 7),
            };
            setDoc(userRef, defaultUser).catch(err => handleFirestoreError(err, OperationType.WRITE, 'users'));
            setUser({ id: firebaseUser.uid, ...defaultUser });
          }
        }, (err) => handleFirestoreError(err, OperationType.GET, 'users'));

        // Listen for History
        const qHistory = query(
          collection(db, "history"),
          where("uid", "==", firebaseUser.uid),
          orderBy("timestamp", "desc"),
        );
        onSnapshot(qHistory, (snapshot) => {
          setHistory(
            snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as any),
          );
        }, (err) => handleFirestoreError(err, OperationType.GET, 'history'));

        // Listen for Folders
        const qFolders = query(
          collection(db, "folders"),
          where("uid", "==", firebaseUser.uid),
          orderBy("timestamp", "desc"),
        );
        onSnapshot(qFolders, (snapshot) => {
          setFolders(
            snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as any),
          );
        }, (err) => handleFirestoreError(err, OperationType.GET, 'folders'));
      } else {
        setUser(null);
        setAuthMode("login");
        setHistory([]);
        setFolders([]);
      }
    });
    return () => unsub();
  }, []);

  const [imageMode, setImageMode] = useState<
    "workshop" | "story" | "multiAngle" | "characterGen"
  >("workshop");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [requestAmount, setRequestAmount] = useState(100);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [upscalingVideoId, setUpscalingVideoId] = useState<number | null>(null);
  const [showUpscaleMenu, setShowUpscaleMenu] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "1:1">("16:9");
  const [imageResolution, setImageResolution] = useState<"1K" | "2K" | "4K">("1K");

  // Folders State
  const { folders, setFolders } = useAppStore();
  const [activeFolder, setActiveFolder] = useState<string | null>("all");

  // Multi Angle State
  const [multiAnglePrompt, setMultiAnglePrompt] = useState("");
  const [multiAngleImage, setMultiAngleImage] = useState<File | null>(null);
  const [multiAngleResults, setMultiAngleResults] = useState<string[]>([]);
  const [isGeneratingMultiAngle, setIsGeneratingMultiAngle] = useState(false);

  // Character Gen State
  const [charGenBgPrompt, setCharGenBgPrompt] = useState("");
  const [charGenBgImages, setCharGenBgImages] = useState<File[]>([]);
  const [charGenGeneratedBgUrl, setCharGenGeneratedBgUrl] = useState<
    string | null
  >(null);
  const [charGenCharPrompt, setCharGenCharPrompt] = useState("");
  const [charGenCharImage, setCharGenCharImage] = useState<File | null>(null);
  const [charGenGeneratedCharUrl, setCharGenGeneratedCharUrl] = useState<
    string | null
  >(null);
  const [charGenPosition, setCharGenPosition] = useState<
    "standing" | "sitting"
  >("standing");
  const [charGenResults, setCharGenResults] = useState<string[]>([]);
  const [isGeneratingCharGen, setIsGeneratingCharGen] = useState(false);
  const [isGeneratingBg, setIsGeneratingBg] = useState(false);
  const [isGeneratingChar, setIsGeneratingChar] = useState(false);

  // Admin State
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminRequests, setAdminRequests] = useState<any[]>([]);
  const [siteHealth, setSiteHealth] = useState<any>({
    activeUsers: 0,
    dailyGenerations: 0,
    apiBottlenecks: [],
    systemStatus: "Optimal",
  });
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserAllowance, setNewUserAllowance] = useState(100);

  const [isEnhancing, setIsEnhancing] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>("");
  const isCancelledRef = useRef(false);

  // --- Gener8 Studio State ---
  const [studioMode, setStudioMode] = useState<
    "character" | "framing" | "directing"
  >("character");
  const [studioCharPrompt, setStudioCharPrompt] = useState(
    "Epic sci-fi warrior, cinematic lighting",
  );
  const [isGeneratingStudioChar, setIsGeneratingStudioChar] = useState(false);
  const [studioFramePrompt, setStudioFramePrompt] = useState("");
  const [studioFrameImage, setStudioFrameImage] = useState<string | null>(null);
  const [isGeneratingStudioFrame, setIsGeneratingStudioFrame] = useState(false);
  const [studioActionPrompt, setStudioActionPrompt] = useState(
    "Slow push-in towards Eva as her hands move down the sword.",
  );
  const [studioAngle, setStudioAngle] = useState("Low Angle");
  const [studioShotType, setStudioShotType] = useState("Medium Shot");
  const [studioFocalLength, setStudioFocalLength] = useState("50mm");
  const [studioLighting, setStudioLighting] = useState("Cinematic");
  const [studioCharacter, setStudioCharacter] = useState<{
    name: string;
    file: File | null;
    url: string | null;
  }>({ name: "Eva", file: null, url: null });
  const [studioCharacterOptions, setStudioCharacterOptions] = useState<string[]>([]);
  const [selectedStudioCharacterIndex, setSelectedStudioCharacterIndex] =
    useState<number>(0);
  const [studioResolution, setStudioResolution] = useState("1080p");
  const [studioAspectRatio, setStudioAspectRatio] = useState("16:9");
  const [studioCamera, setStudioCamera] = useState("ARRI Signature Prime");
  const [studioTransition, setStudioTransition] = useState("Cut");
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);
  const [studioResult, setStudioResult] = useState<string | null>(null);
  const [studioResultType, setStudioResultType] = useState<
    "image" | "video" | null
  >(null);

  const callGemini = async (
    model: string,
    contents: any,
    config?: any,
    type?: "video" | "operation",
  ) => {
    // Check API key selection for premium models
    const isPremiumModel =
      model.includes("image") ||
      model.includes("gemini-3-pro-image-preview") ||
      model.includes("gemini-3.1-flash-image") ||
      model.includes("gemini-2.5-flash-image") ||
      model.includes("veo") ||
      model.includes("lyria");
    if (isPremiumModel) {
      if (
        window.aistudio &&
        typeof window.aistudio.hasSelectedApiKey === "function"
      ) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      }
    }

    const makeCall = async () => {
      const isDevEnv =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.includes("run.app");

      // Try calling our backend proxy if this is deployed outside of AI Studio or if key is missing locally
      if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
        try {
          const isVideoOrOp = type === "video" || model.includes("veo") || type === "operation";
          const res = await fetch("/api/ai/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
               model, 
               contents: isVideoOrOp 
                 ? contents
                 : (typeof contents === 'string' 
                   ? [{ role: 'user', parts: [{ text: contents }] }] 
                   : Array.isArray(contents)
                     ? contents
                     : [{ role: 'user', parts: contents.parts || [contents] }]), 
               config, 
               type 
            })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP error ${res.status}`);
          }
          const data = await res.json();

          if (type === "video" || model.includes("veo") || type === "operation") {
            return data;
          }

          return {
            candidates: data.candidates?.map((c: any) => ({
              content: { parts: c.content?.parts || [] }
            })) || [],
            text: data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || "",
          };
        } catch (e: any) {
          console.error("Backend AI proxy failed:", e);
          throw new Error("Backend AI Generation failed: " + e.message);
        }
      }

      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;

      const { GoogleGenAI } = await import("@google/genai");
      // The browser environment might intercept `fetch` and inject the selected API Key
      const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key-for-interception" });

      if (type === "video" || model.includes("veo")) {
        const reqFields: any = {
          model,
          prompt: contents,
          config: { ...config }
        };
        
        if (config && config.referenceImages && config.referenceImages.length > 0) {
           reqFields.image = config.referenceImages[0].image;
           delete reqFields.config.referenceImages;
        } else if (config && config.image) {
           reqFields.image = config.image;
           delete reqFields.config.image;
        }
        
        return await (ai as any).models.generateVideos(reqFields);
      }

      if (type === "operation") {
        return await (ai as any).operations.getVideosOperationInternal({
          operationName: contents.name,
        });
      }

      // Default: generateContent
      const response = await ai.models.generateContent({
        model,
        contents:
          typeof contents === "string"
            ? [{ role: "user", parts: [{ text: contents }] }]
            : Array.isArray(contents)
              ? contents
              : [{ role: "user", parts: contents.parts || [contents] }],
        config,
      });

      // Return in a format compatible with the existing code
      return {
        candidates:
          response.candidates?.map((c: any) => ({
            content: {
              parts: c.content?.parts || [],
            },
          })) || [],
        text: response.text,
      };
    };

    try {
      return await makeCall();
    } catch (err: any) {
      const errorStr =
        JSON.stringify(err).toUpperCase() + (err.message || "").toUpperCase();
      if (
        isPremiumModel &&
        (errorStr.includes("NOT FOUND") ||
          errorStr.includes("REQUESTED ENTITY WAS NOT FOUND") ||
          errorStr.includes("API KEY"))
      ) {
        if (
          window.aistudio &&
          typeof window.aistudio.openSelectKey === "function"
        ) {
          await window.aistudio.openSelectKey();
          return await makeCall(); // Retry once after selecting a new key
        }
      }
      err.message = `[Model: ${model}] ${err.message || "Unknown error"}`;
      console.error("Gemini API Error details:", {
        model,
        contents,
        config,
        error: err,
      });
      throw err;
    }
  };

  const handleEnhancePrompt = async (
    currentPrompt: string,
    setPrompt: (val: string) => void,
  ) => {
    if (!currentPrompt) return;
    setIsEnhancing(true);
    try {
      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash",
          `Enhance the following prompt for an AI image/video generator. 
        Focus specifically on the AUTOMOTIVE industry. 
        Add technical details like lighting (golden hour, studio lighting, neon reflections), 
        camera angles (low angle, tracking shot, close-up on rims), 
        materials (carbon fiber, metallic paint, leather textures), and cinematic atmosphere. 
        Keep the core intent but make it professional, high-fidelity, and visually stunning.
        
        Original Prompt: ${currentPrompt}
        
        Return ONLY the enhanced prompt text, no other commentary.`,
        ),
      );

      if (response.text) {
        setPrompt(response.text.trim());
      }
    } catch (err) {
      console.error("Enhancement failed", err);
      setErrorMessage("Failed to enhance prompt.");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleEnhanceStoryPrompt = async (index: number) => {
    const currentPrompt = storyPrompts[index]?.prompt;
    if (!currentPrompt) return;

    setIsEnhancing(true);
    try {
      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash",
          `Enhance the following prompt for an AI image generator. 
        Make it highly detailed, cinematic, and visually stunning. 
        Add specific details about lighting, camera angle, atmosphere, and composition to ensure the best possible output.
        Keep the core narrative intent intact.
        
        Original Prompt: ${currentPrompt}
        
        Return ONLY the enhanced prompt text, no other commentary.`,
        ),
      );

      if (response.text) {
        setStoryPrompts((prev) =>
          prev.map((p, i) =>
            i === index ? { ...p, prompt: response.text.trim() } : p,
          ),
        );
      }
    } catch (err) {
      console.error("Story prompt enhancement failed", err);
      setErrorMessage("Failed to enhance story prompt.");
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleEnhanceScript = async () => {
    if (!storyScript) return;
    setIsProcessingStory(true);
    setErrorMessage(null);
    try {
      const docContents = await Promise.all(storyDocuments.map(fileToText));
      const referenceDocs = docContents
        .map(
          (content, i) =>
            `--- Document: ${storyDocuments[i].name} ---\n${content}`,
        )
        .join("\n\n");

      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash",
          `Enhance the following script for a cinematic production. Focus on vivid descriptions, emotional depth, and visual storytelling. Expand on key moments and add sensory details.
        
        ${storyContextPrompt ? `Context: ${storyContextPrompt}\n\n` : ""}${referenceDocs ? `Reference Documents:\n${referenceDocs}\n\n` : ""}Original Script: ${storyScript}
        
        Return ONLY the enhanced script text, no other commentary.`,
        ),
      );

      if (response.text) {
        setStoryScript(response.text.trim());
      }
    } catch (err) {
      console.error("Script enhancement failed", err);
      setErrorMessage("Failed to enhance script.");
    } finally {
      setIsProcessingStory(false);
    }
  };

  const handleSubmitStory = async () => {
    if (!storyScript) return;
    setIsProcessingStory(true);
    setErrorMessage(null);
    setStoryPrompts([]);

    try {
      const docContents = await Promise.all(storyDocuments.map(fileToText));
      const referenceDocs = docContents
        .map(
          (content, i) =>
            `--- Document: ${storyDocuments[i].name} ---\n${content}`,
        )
        .join("\n\n");

      const fullPrompt = `Segment the following cinematic script into distinct scenes or key moments. For each segment, generate a concise, high-fidelity text-to-image prompt suitable for an AI image generator (like Nano Banana). Focus on visual descriptions, camera angles, lighting, and mood for each prompt. For each prompt, also identify the exact segment of the original script it corresponds to. Return the prompts as a JSON array of objects, where each object has a 'prompt' field (string) and a 'sourceSegment' field (string).\n\n${storyContextPrompt ? `Context: ${storyContextPrompt}\n\n` : ""}${referenceDocs ? `Reference Documents:\n${referenceDocs}\n\n` : ""}Script: ${storyScript}\n\nReturn ONLY a JSON array of objects, no other commentary.`;

      // Simple character limit check as a proxy for token limit
      const MAX_PROMPT_LENGTH = 100000; // Increased limit to accommodate longer scripts and documents
      if (fullPrompt.length > MAX_PROMPT_LENGTH) {
        throw new Error(
          `Combined script and document content exceeds the maximum limit of ${MAX_PROMPT_LENGTH} characters. Please shorten your script or reduce document content.`,
        );
      }

      const response = await withRetry(async () =>
        callGemini("gemini-2.5-flash", fullPrompt, {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                prompt: { type: "STRING" },
                sourceSegment: { type: "STRING" },
              },
              required: ["prompt", "sourceSegment"],
            },
          },
        }),
      );

      if (response.text) {
        const parsedPrompts: { prompt: string; sourceSegment: string }[] =
          JSON.parse(response.text.trim());
        setStoryPrompts(
          parsedPrompts.map((p) => ({ ...p, generatedImage: null })),
        );
      }
    } catch (err) {
      console.error("Story processing failed", err);
      setErrorMessage("Failed to process story and generate prompts.");
    } finally {
      setIsProcessingStory(false);
    }
  };

  // Images State
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageReferences, setImageReferences] = useState<
    { file: File | null; preview: string }[]
  >([]);
  const [imageVariations, setImageVariations] = useState(1);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);

  // Video Suite State
  const [videoMode, setVideoMode] = useState<"flow" | "automator">("flow");
  const [videoFlowAssetMode, setVideoFlowAssetMode] = useState<
    "ingredients" | "frames"
  >("ingredients");
  const [showVideoFlowMenu, setShowVideoFlowMenu] = useState(false);
  const [mediaLibraryTarget, setMediaLibraryTarget] = useState<
    "character" | "style" | "setting" | "start" | "end" | null
  >(null);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoVariations, setVideoVariations] = useState(1);
  const [videoResults, setVideoResults] = useState<
    { id: number; url: string }[]
  >([]);

  // Automator State
  const [automatorSheetId, setAutomatorSheetId] = useState("");
  const [automatorStatus, setAutomatorStatus] = useState<
    "idle" | "fetching" | "processing" | "stitching" | "complete" | "error"
  >("idle");
  const [automatorClips, setAutomatorClips] = useState<{
    prompt: string;
    status: "pending" | "generating" | "complete" | "error";
    url?: string;
    error?: string;
    referenceSelection: number | null;
  }[]>([]);
  const [isGeneratingScenario, setIsGeneratingScenario] = useState(false);
  const [automatorFinalVideo, setAutomatorFinalVideo] = useState<string | null>(
    null,
  );
  const [automatorProgress, setAutomatorProgress] = useState(0);
  const [automatorReferences, setAutomatorReferences] = useState<
    { file: File; preview: string }[]
  >([]);
  const [automatorHeaders, setAutomatorHeaders] = useState<string[]>([]);
  const [automatorSelectedColumn, setAutomatorSelectedColumn] = useState("");
  const [automatorRows, setAutomatorRows] = useState<any[]>([]);
  const [automatorReferenceSelection, setAutomatorReferenceSelection] =
    useState<"all" | "0" | "1" | "2">("all");
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Story State
  const [storyContextPrompt, setStoryContextPrompt] = useState("");
  const [storyScript, setStoryScript] = useState("");
  const [storyPrompts, setStoryPrompts] = useState<
    { prompt: string; sourceSegment: string; generatedImage: string | null }[]
  >([]);
  const [isProcessingStory, setIsProcessingStory] = useState(false);
  const [storyDocuments, setStoryDocuments] = useState<File[]>([]);

  // Video Inputs
  const [ingredients, setIngredients] = useState<{
    character: File | string | null;
    style: File | string | null;
    setting: File | string | null;
  }>({ character: null, style: null, setting: null });
  const [framePair, setFramePair] = useState<{
    start: { file: File | string | null; preview: string } | null;
    end: { file: File | string | null; preview: string } | null;
  }>({ start: null, end: null });

  // --- Initial Data Fetch ---
  useEffect(() => {
    // Auth and history are now handled by onAuthStateChanged in the main App component
  }, []);

  // --- Handlers ---
  // --- Automator Logic ---
  const loadFFmpeg = async () => {
    try {
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
    } catch (err) {
      console.error("FFmpeg load failed", err);
      throw new Error("Failed to load video processing engine.");
    }
  };

  const fetchGoogleSheetData = async (sheetId: string) => {
    // Extract ID if full URL is provided
    const idMatch = sheetId.match(/[-\w]{25,}/);
    const id = idMatch ? idMatch[0] : sheetId;

    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        "Failed to fetch Google Sheet. Ensure it is public (Anyone with link can view).",
      );
    const csv = await response.text();

    // Simple CSV parser (assuming first row is header)
    const lines = csv.split("\n").filter((l) => l.trim());
    if (lines.length < 2)
      throw new Error("Sheet is empty or missing data rows.");

    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const rows = lines.slice(1).map((line) => {
      // Handle commas inside quotes
      const values: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === "," && !inQuotes) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const obj: any = {};
      headers.forEach((h, i) => {
        if (values[i] !== undefined) obj[h] = values[i].replace(/^"|"$/g, "");
      });
      return obj;
    });
    return rows;
  };

  const stitchVideos = async (urls: string[]) => {
    if (!ffmpegRef.current) {
      setGenerationStatus("Initializing video engine (30MB download)...");
      await loadFFmpeg();
    }
    const ffmpeg = ffmpegRef.current!;

    // Add progress listener for FFmpeg
    const progressHandler = ({ progress }: { progress: number }) => {
      // Scale FFmpeg progress (0-1) to 95-99% range
      setAutomatorProgress(95 + progress * 4);
    };
    ffmpeg.on("progress", progressHandler);

    try {
      // Write files to FFmpeg virtual FS
      const filenames: string[] = [];
      for (let i = 0; i < urls.length; i++) {
        setGenerationStatus(`Downloading clip ${i + 1}/${urls.length}...`);
        // Progress: 90% to 95% during downloads
        setAutomatorProgress(90 + (i / urls.length) * 5);

        const name = `input${i}.mp4`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        try {
          const response = await fetch(urls[i], { signal: controller.signal });
          if (!response.ok) throw new Error(`Failed to fetch clip ${i + 1}`);
          const buffer = await response.arrayBuffer();
          const data = new Uint8Array(buffer);
          await ffmpeg.writeFile(name, data);
          filenames.push(name);
        } finally {
          clearTimeout(timeoutId);
        }
      }

      setAutomatorProgress(95);
      // Create concat file
      const concatContent = filenames.map((f) => `file ${f}`).join("\n");
      await ffmpeg.writeFile("concat.txt", concatContent);

      setGenerationStatus("Stitching clips together...");
      try {
        const exitCode = await ffmpeg.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "concat.txt",
          "-c",
          "copy",
          "output.mp4",
        ]);
        if (exitCode !== 0) throw new Error("Fast stitch failed");
      } catch (e) {
        console.warn("Fast concat failed, falling back to re-encoding", e);
        setGenerationStatus(
          "Optimizing clips for compatibility (this may take 1-2 minutes)...",
        );
        const exitCode = await ffmpeg.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "concat.txt",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
          "output.mp4",
        ]);
        if (exitCode !== 0)
          throw new Error("Film assembly failed during re-encoding.");
      }

      setAutomatorProgress(99);
      setGenerationStatus("Finalizing production...");
      const data = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([data], { type: "video/mp4" });

      // Cleanup
      for (const name of filenames) {
        try {
          await ffmpeg.deleteFile(name);
        } catch (e) {}
      }
      try {
        await ffmpeg.deleteFile("concat.txt");
      } catch (e) {}
      try {
        await ffmpeg.deleteFile("output.mp4");
      } catch (e) {}

      setGenerationStatus("");
      return URL.createObjectURL(blob);
    } finally {
      ffmpeg.off("progress", progressHandler);
    }
  };

  const handleLoadSheet = async () => {
    if (!automatorSheetId) return;
    setAutomatorStatus("fetching");
    setErrorMessage(null);
    setAutomatorRows([]);
    setAutomatorHeaders([]);
    setAutomatorSelectedColumn("");

    try {
      const rows = await fetchGoogleSheetData(automatorSheetId);
      if (rows.length === 0) throw new Error("No data found in sheet.");
      const headers = Object.keys(rows[0]);
      setAutomatorHeaders(headers);
      setAutomatorRows(rows);
      setAutomatorReferenceSelection("all");
      const defaultKey =
        headers.find(
          (k) =>
            k.toLowerCase().includes("prompt") ||
            k.toLowerCase().includes("description"),
        ) || headers[0];
      setAutomatorSelectedColumn(defaultKey);

      // Initialize clips
      const initialClips = rows.map((row: any) => ({
        prompt: row[defaultKey] || "",
        status: "pending" as const,
        referenceSelection: null,
      }));
      setAutomatorClips(initialClips);

      setAutomatorStatus("idle");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load sheet");
      setAutomatorStatus("error");
    }
  };

  const uploadImage = async (base64Data: string) => {
    const isDataUrl = base64Data.startsWith("data:");
    const dataUrl = isDataUrl ? base64Data : `data:image/png;base64,${base64Data}`;

    if (!auth.currentUser) return dataUrl;

    try {
      const uid = auth.currentUser.uid;
      const dataToUpload = base64Data;
      let format: any = "base64";
      if (isDataUrl) {
        format = "data_url";
      }

      // We append a random string to avoid overwriting existing files
      const filename = `${uid}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
      const storageRef = ref(storage, filename);
      await uploadString(storageRef, dataToUpload, format, {
        contentType: "image/png",
      });
      const url = await getDownloadURL(storageRef);
      return url;
    } catch (err) {
      console.warn("Storage upload failed, attempting local API upload", err);
      // Fallback to local API upload to avoid huge Data URLs in Firestore
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ image: dataUrl })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) return data.url;
        }
      } catch (localErr) {
        console.warn("Local API upload also failed", localErr);
      }
      return dataUrl;
    }
  };

  const chargeCredits = async (amount: number) => {
    if (!auth.currentUser) return;
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const docSnap = await getDoc(userRef);
      if (docSnap.exists()) {
        const currentCredits = docSnap.data().credits || 0;
        await updateDoc(userRef, { credits: currentCredits - amount });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'users');
    }
  };

  const saveHistory = async (type: string, dataUrlOrBlobUrl: string, prompt: string) => {
    if (!auth.currentUser) return;
    try {
      let finalUrl = dataUrlOrBlobUrl;
      try {
        const fetchRes = await fetch(dataUrlOrBlobUrl);
        const blob = await fetchRes.blob();
        const ext = blob.type.split("/")[1] || "bin";
        const storageRef = ref(storage, `history/${auth.currentUser.uid}/${Date.now()}.${ext}`);
        await uploadBytes(storageRef, blob);
        finalUrl = await getDownloadURL(storageRef);
      } catch (e) {
        console.error("Failed to upload to storage", e);
      }
      
      await addDoc(collection(db, "history"), {
        uid: auth.currentUser.uid,
        type,
        url: finalUrl,
        prompt,
        timestamp: Date.now(),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'history');
      console.error("Failed to save history:", e);
    }
  };

  const withRetry = async <T extends unknown>(
    fn: () => Promise<T>,
    maxRetries = 5,
    initialDelay = 5000,
  ): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      if (isCancelledRef.current)
        throw new Error("Operation cancelled by user");
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const errorStr = JSON.stringify(err).toUpperCase();

        if (
          errorStr.includes("NOT FOUND") ||
          errorStr.includes("REQUESTED ENTITY WAS NOT FOUND")
        ) {
          throw new Error("API Model not found. Please check the model name.");
        }

        if (errorStr.includes("BILLING") || errorStr.includes("PAYMENT")) {
          throw new Error(
            "Billing issue detected. Please ensure your Google Cloud project has an active billing account linked.",
          );
        }

        if (
          errorStr.includes("PERMISSION_DENIED") ||
          errorStr.includes("403")
        ) {
          throw new Error(
            "Permission denied (403). Ensure the Gemini API is enabled in your Google Cloud project and your key has sufficient permissions.",
          );
        }

        const isRetryable =
          errorStr.includes("429") ||
          errorStr.includes("RESOURCE_EXHAUSTED") ||
          errorStr.includes("QUOTA") ||
          errorStr.includes("LIMIT") ||
          errorStr.includes("503") ||
          errorStr.includes("504") ||
          errorStr.includes("500") ||
          errorStr.includes("INTERNAL") ||
          errorStr.includes("UNAVAILABLE") ||
          errorStr.includes("DEADLINE EXPIRED") ||
          err.status === 429 ||
          err.status === 503 ||
          err.status === 504 ||
          err.status === 500 ||
          (err.error &&
            (err.error.code === 429 ||
              err.error.code === 503 ||
              err.error.code === 504 ||
              err.error.code === 500 ||
              err.error.status === "RESOURCE_EXHAUSTED" ||
              err.error.status === "UNAVAILABLE" ||
              err.error.status === "INTERNAL")) ||
          (err.response &&
            (err.response.status === 429 ||
              err.response.status === 503 ||
              err.response.status === 504 ||
              err.response.status === 500));

        if (isRetryable && i < maxRetries - 1) {
          // Faster backoff for paid tier: 5s, 10s, 20s...
          const delay = initialDelay * Math.pow(2, i) + Math.random() * 2000;
          const msg = `Service busy or limit reached. Retrying in ${Math.round(delay / 1000)}s... (Attempt ${i + 1}/${maxRetries})`;
          console.warn(msg);
          setGenerationStatus(msg);
          setAutomatorStatus(`retrying (${Math.round(delay / 1000)}s)`);

          // Check for cancellation during the wait period
          const waitStartTime = Date.now();
          while (Date.now() - waitStartTime < delay) {
            if (isCancelledRef.current)
              throw new Error("Operation cancelled by user");
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          setAutomatorStatus("processing");
          continue;
        }

        if (errorStr.includes("500") || errorStr.includes("INTERNAL")) {
          err.message =
            "The AI model encountered a complex request and couldn't generate this specific output. Please try slightly modifying your prompt or using a different reference image.";
        }

        console.error("Gemini API Fatal Error:", err);
        throw err;
      }
    }
    throw lastError;
  };

  const handleGenerateScenario = async (topic: string) => {
    if (!topic) return;
    setIsGeneratingScenario(true);
    setErrorMessage(null);
    try {
      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash",
          `Create a 5-step professional training role-play scenario about: "${topic}". 
        Return a JSON array of objects. Each object must have:
        - "visual_prompt": A highly detailed cinematic prompt for a video generator (no text in video).
        Example: [{"visual_prompt": "Close up of a professional woman in an office looking concerned..."}]`,
          {
            responseMimeType: "application/json",
          },
        ),
      );

      const scenario = JSON.parse(response.text || "[]");
      setAutomatorHeaders(["visual_prompt"]);
      setAutomatorRows(scenario);
      setAutomatorSelectedColumn("visual_prompt");
      setAutomatorStatus("idle");
    } catch (err: any) {
      setErrorMessage("Failed to generate scenario: " + err.message);
    } finally {
      setIsGeneratingScenario(false);
    }
  };

  const handleStartAutomation = async () => {
    if (automatorClips.length === 0) return;
    setAutomatorStatus("processing");
    setAutomatorFinalVideo(null);
    setAutomatorProgress(0);
    setErrorMessage(null);

    try {
      const generatedUrls: string[] = [];

      for (let i = 0; i < automatorClips.length; i++) {
        // Skip if already complete
        if (automatorClips[i].status === "complete" && automatorClips[i].url) {
          generatedUrls.push(automatorClips[i].url!);
          continue;
        }

        setAutomatorClips((prev) =>
          prev.map((c, idx) =>
            idx === i ? { ...c, status: "generating" } : c,
          ),
        );

        try {
          let operation;
          const clipRefSelection = automatorClips[i].referenceSelection;
          const selectedRefs = clipRefSelection !== null && automatorReferences[clipRefSelection] ? [automatorReferences[clipRefSelection]] : [];

          if (selectedRefs.length > 0) {
            const referenceImagesPayload = await Promise.all(
              selectedRefs.map(async (ref) => ({
                image: {
                  imageBytes: (await fileToBase64(ref.file)) || "",
                  mimeType: ref.file.type,
                },
                referenceType: "ASSET",
              })),
            );

            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                automatorClips[i].prompt,
                {
                  numberOfVideos: 1,
                  referenceImages: referenceImagesPayload,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          } else {
            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                automatorClips[i].prompt,
                {
                  numberOfVideos: 1,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          }

          let currentOp = operation;
          while (!currentOp.done) {
            if (isCancelledRef.current)
              throw new Error("Automation cancelled by user");
            // Increased polling interval to 30s to reduce RPM usage
            await new Promise((r) => setTimeout(r, 30000));
            currentOp = await withRetry(async () =>
              callGemini("", currentOp, null, "operation"),
            );
          }

          if (currentOp.error) {
            throw new Error(
              `Generation failed: ${currentOp.error.message || "Unknown error"}`,
            );
          }

          const downloadLink =
            (currentOp.response?.generatedVideos?.[0]?.video?.uri || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (currentOp as any).response?.generatedSamples?.[0]?.video?.uri) || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (currentOp as any).response?.generatedSamples?.[0]?.video?.uri || (currentOp as any).uri || currentOp.response?.uri;
          if (!downloadLink) {
            // Check for safety filters
            const safetyDetails =
              (currentOp.response?.generatedVideos?.[0]?.video?.videoMetadata || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.videoMetadata || (currentOp as any).response?.generatedSamples?.[0]?.video?.videoMetadata)
                ?.safetyDetails;
            if (safetyDetails) {
              throw new Error(
                "Video blocked by safety filters. Please refine your prompt.",
              );
            }
            throw new Error(
              "No video generated. The API returned an empty response.",
            );
          }

          let videoRes;
          if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
            videoRes = await fetch(`/api/ai/video-proxy?url=${encodeURIComponent(downloadLink)}`);
          } else {
            const apiKey =
              (window.aistudio && typeof (window as any).aistudio.getApiKey === "function" ? await (window as any).aistudio.getApiKey() : null) || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
            videoRes = await fetch(downloadLink, {
              headers: { "x-goog-api-key": apiKey },
            });
          }
          const blob = await videoRes.blob();
          const url = URL.createObjectURL(blob);

          generatedUrls.push(url);
          setAutomatorClips((prev) =>
            prev.map((c, idx) =>
              idx === i ? { ...c, status: "complete", url } : c,
            ),
          );
          setAutomatorProgress(((i + 1) / automatorClips.length) * 80); // 80% for generation

          // Save to history and refresh history incrementally
          try {
            await saveHistory("video", url, automatorClips[i].prompt);
          } catch (hErr) {
            console.error("Failed to save clip to history", hErr);
          }

          // Short delay between clips for paid tier
          if (i < automatorClips.length - 1) {
            setGenerationStatus("Preparing next clip...");
            await new Promise((r) => setTimeout(r, 10000));
          }
        } catch (err: any) {
          console.error(`Clip ${i} failed`, err);
          const errorMsg = err.message || JSON.stringify(err).toUpperCase();
          setAutomatorClips((prev) =>
            prev.map((c, idx) => (idx === i ? { ...c, status: "error" } : c)),
          );

          if (
            errorMsg.includes("429") ||
            errorMsg.includes("QUOTA") ||
            errorMsg.includes("EXHAUSTED")
          ) {
            setErrorMessage(
              "Daily quota or RPM limit exceeded. The system tried to retry but failed. Please check your Google Cloud billing or wait for your quota to reset.",
            );
          }
        }
      }

      if (generatedUrls.length === 0)
        throw new Error("No clips were successfully generated.");

      setAutomatorStatus("complete");
      setAutomatorProgress(100);
    } catch (err: any) {
      console.error("Automation failed", err);
      setErrorMessage(err.message || "Automation failed");
      setAutomatorStatus("error");
    }
  };

  const handleStitchClips = async () => {
    const urls = automatorClips
      .filter((c) => c.status === "complete" && c.url)
      .map((c) => c.url!);
    if (urls.length === 0) return;

    setAutomatorStatus("stitching");
    setAutomatorProgress(90);
    try {
      const finalVideoUrl = await stitchVideos(urls);
      setAutomatorFinalVideo(finalVideoUrl);
      setAutomatorStatus("complete");
      setAutomatorProgress(100);

      // Save final film to history
      try {
        await saveHistory(
          "video",
          finalVideoUrl,
          `[CAST FINAL FILM] ${urls.length} clips stitched.`,
        );
      } catch (hErr) {
        console.error("Failed to save final film to history", hErr);
      }
    } catch (err: any) {
      console.error("Stitching failed", err);
      setErrorMessage("Failed to stitch videos: " + err.message);
      setAutomatorStatus("error");
    }
  };

  const handleClearAutomator = () => {
    setAutomatorReferences([]);
    setAutomatorClips([]);
    setAutomatorRows([]);
    setAutomatorHeaders([]);
    setAutomatorSheetId("");
    setAutomatorFinalVideo(null);
    setAutomatorProgress(0);
    setAutomatorStatus("idle");
  };

  const handleRetryFailedClips = async () => {
    if (automatorStatus === "processing") return;

    setAutomatorStatus("processing");
    setAutomatorProgress(0);
    setErrorMessage(null);

    try {
      const failedIndices = automatorClips
        .map((c, i) => (c.status === "error" ? i : -1))
        .filter((i) => i !== -1);

      for (const i of failedIndices) {
        try {
          setAutomatorClips((prev) =>
            prev.map((c, idx) =>
              idx === i ? { ...c, status: "generating" } : c,
            ),
          );

          let operation;
          const clipRefSelection = automatorClips[i].referenceSelection;
          const selectedRefs = clipRefSelection !== null && automatorReferences[clipRefSelection] ? [automatorReferences[clipRefSelection]] : [];

          if (selectedRefs.length > 0) {
            const referenceImagesPayload = await Promise.all(
              selectedRefs.map(async (ref) => ({
                image: {
                  imageBytes: (await fileToBase64(ref.file)) || "",
                  mimeType: ref.file.type,
                },
                referenceType: "ASSET",
              })),
            );

            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                automatorClips[i].prompt,
                {
                  numberOfVideos: 1,
                  referenceImages: referenceImagesPayload,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          } else {
            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                automatorClips[i].prompt,
                {
                  numberOfVideos: 1,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          }

          let currentOp = operation;
          while (!currentOp.done) {
            if (isCancelledRef.current)
              throw new Error("Automation cancelled by user");
            await new Promise((r) => setTimeout(r, 30000));
            currentOp = await withRetry(async () =>
              callGemini("", currentOp, null, "operation"),
            );
          }

          if (currentOp.error) {
            throw new Error(
              `Generation failed: ${currentOp.error.message || "Unknown error"}`,
            );
          }

          const downloadLink =
            (currentOp.response?.generatedVideos?.[0]?.video?.uri || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (currentOp as any).response?.generatedSamples?.[0]?.video?.uri) || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (currentOp as any).response?.generatedSamples?.[0]?.video?.uri || (currentOp as any).uri || currentOp.response?.uri;
          if (!downloadLink) {
            // Check for safety filters
            const safetyDetails =
              (currentOp.response?.generatedVideos?.[0]?.video?.videoMetadata || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.videoMetadata || (currentOp as any).response?.generatedSamples?.[0]?.video?.videoMetadata)
                ?.safetyDetails;
            if (safetyDetails) {
              throw new Error(
                "Video blocked by safety filters. Please refine your prompt.",
              );
            }
            throw new Error(
              "No video generated. The API returned an empty response.",
            );
          }

          let videoRes;
          if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
            videoRes = await fetch(`/api/ai/video-proxy?url=${encodeURIComponent(downloadLink)}`);
          } else {
            const apiKey =
              (window.aistudio && typeof (window as any).aistudio.getApiKey === "function" ? await (window as any).aistudio.getApiKey() : null) || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
            videoRes = await fetch(downloadLink, {
              headers: { "x-goog-api-key": apiKey },
            });
          }
          const blob = await videoRes.blob();
          const url = URL.createObjectURL(blob);

          setAutomatorClips((prev) =>
            prev.map((c, idx) =>
              idx === i ? { ...c, status: "complete", url } : c,
            ),
          );

          // Save to history
          try {
            await saveHistory("video", url, automatorClips[i].prompt);
          } catch (hErr) {
            console.error("Failed to save retried clip to history", hErr);
          }

          if (i !== failedIndices[failedIndices.length - 1]) {
            await new Promise((r) => setTimeout(r, 20000));
          }
        } catch (err: any) {
          console.error(`Retry for Clip ${i} failed`, err);
          setAutomatorClips((prev) =>
            prev.map((c, idx) => (idx === i ? { ...c, status: "error" } : c)),
          );
        }
      }

      setAutomatorStatus("idle");
      setAutomatorProgress(100);
    } catch (err: any) {
      console.error("Retry failed", err);
      setErrorMessage(err.message || "Retry failed");
      setAutomatorStatus("error");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleAuth = async () => {
    setErrorMessage(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setAuthMode("login");
    // Clear all session-specific state
    setHistory([]);
    setFolders([]);
    setGeneratedImages([]);
    setVideoResults([]);
    window.location.reload(); // Force a full page reload to clear all state
    setImagePrompt("");
    setImageReferences([]);
    setVideoPrompt("");
    setIngredients({ character: null, style: null, setting: null });
    setFramePair({ start: null, end: null });
    setErrorMessage(null);
    navigate("/images");
  };

  const handleRequestCredits = async () => {
    try {
      if (!auth.currentUser) return;
      await addDoc(collection(db, "credit_requests"), {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        amount: requestAmount,
        timestamp: Date.now(),
      });
      setShowRequestModal(false);
      setErrorMessage("Credit request sent to admin.");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'credit_requests');
      setErrorMessage("Failed to send request.");
    }
  };

  const fetchAdminData = async () => {
    if (user?.role !== "admin") return;
    try {
      // Fetch users and requests
      const { getDocs, query, collection } = await import('firebase/firestore');
      const usersSnap = await getDocs(query(collection(db, "users")));
      const usersList = usersSnap.docs.map(d => ({id: d.id, ...d.data()}));
      setAdminUsers(usersList);

      // Simulate health monitoring
      setSiteHealth({
        activeUsers: usersList.length,
        dailyGenerations: Math.floor(Math.random() * 500) + 100,
        apiBottlenecks: [],
        systemStatus: "Optimal",
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, 'users');
      console.error("fetchAdminData err:", e);
    }
  };

  useEffect(() => {
    if (activeTab === "admin") {
      fetchAdminData();
    }
  }, [activeTab]);

  const handleApproveRequest = async (requestId: string) => {
    alert("Admin functionality placeholder");
  };

  const handleDeleteUser = async (userId: string) => {
    if (
      !confirm(
        "Are you sure you want to permanently remove this account and all its history?",
      )
    )
      return;
    try {
      await deleteDoc(doc(db, "users", userId));
      fetchAdminData();
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, 'users/' + userId);
      setErrorMessage(err.message);
    }
  };

  const handleUpdateCredits = async (
    userId: string,
    currentCredits: number,
  ) => {
    const newAmount = prompt(
      "Enter new credit balance:",
      currentCredits.toString(),
    );
    if (newAmount === null || isNaN(Number(newAmount))) return;

    try {
      await updateDoc(doc(db, "users", userId), { credits: Number(newAmount) });
      fetchAdminData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users/' + userId);
      setErrorMessage("Failed to update credits.");
    }
  };

  // --- Constants ---
  const LOVY_GRADIENT = "linear-gradient(135deg, #6A3093 0%, #E91E63 100%)";
  const IMAGE_GEN_COST = 2;
  const IMAGE_UPSCALE_COST = 10;
  const VIDEO_COST = 10;
  const VIDEO_UPSCALE_COST = 20;

  // --- API Utilities ---
  const compressAndEncode = (blob: Blob): Promise<string | null> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 1920;
          const MAX_HEIGHT = 1080;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85); // Compress to 85% JPEG
          resolve(dataUrl.split(",")[1]);
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const fileToBase64 = async (
    fileOrUrl: File | string | null,
  ): Promise<string | null> => {
    if (!fileOrUrl) return null;
    if (typeof fileOrUrl === "string") {
      if (fileOrUrl.startsWith("data:")) {
        return fileOrUrl.split(",")[1];
      }
      // Fetch URL and convert to base64
      try {
        const response = await fetch(fileOrUrl);
        const blob = await response.blob();
        return await compressAndEncode(blob);
      } catch (err) {
        console.error("Failed to fetch image URL:", err);
        return null;
      }
    }
    if (!(fileOrUrl instanceof File)) return null;
    return await compressAndEncode(fileOrUrl);
  };

  const fileToText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  // --- Handlers ---
  const handleFrameUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: "start" | "end",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setFramePair((prev) => ({
        ...prev,
        [slot]: { file, preview: reader.result as string },
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleImageRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (imageReferences.length + files.length > 5) {
      setErrorMessage("Reference library capacity is 5 assets.");
      return;
    }
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageReferences((prev) => [
          ...prev,
          { file, preview: reader.result as string },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const iterateOnImage = (imageUrl: string) => {
    if (imageReferences.length >= 5) {
      setErrorMessage("Library full. Remove an asset to iterate.");
      return;
    }
    setImageReferences((prev) => [...prev, { file: null, preview: imageUrl }]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGenerateImages = async (
    prompt: string,
    aspectRatio?: "16:9" | "1:1",
    imageSize?: "1K" | "2K" | "4K",
  ) => {
    const totalCost = imageVariations * IMAGE_GEN_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationProgress(0);
    const newGens: string[] = [];

    let progressInterval: any = null;
    try {
      // Progress simulation
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      const referenceParts = await Promise.all(
        imageReferences.map(async (ref) => {
          const data = await fileToBase64(ref.file || ref.preview);
          return {
            inlineData: {
              mimeType: "image/png",
              data: data || "",
            },
          };
        }),
      );

      // Generate images one by one for simplicity in this demo
      for (let i = 0; i < imageVariations; i++) {
        const response = await withRetry(async () =>
          callGemini(
            "gemini-2.5-flash-image",
            {
              parts: [
                {
                  text: `GENERATE ${aspectRatio || "16:9"} CINEMATIC ASSET: ${imagePrompt}. Ensure avatars maintain exact visual continuity with references. Apply a slight cinematic gaussian blur to the background to integrate the avatar naturally into the scene. Format: ${aspectRatio || "16:9"} Landscape. Output: PNG.`,
                },
                ...referenceParts,
              ],
            },
            {
              imageConfig: {
                aspectRatio: aspectRatio || "16:9",
                imageSize: imageSize || "1K",
              },
            },
          ),
        );

        const imagePart = response.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData,
        );
        if (imagePart?.inlineData) {
          const newUrl = await uploadImage(imagePart.inlineData.data);
          newGens.push(newUrl);
        }

        if (i < imageVariations - 1) {
          setGenerationStatus(`Preparing next variation...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setGeneratedImages(newGens);
      setImageReferences([]);

      // Update credits on backend
      await chargeCredits(totalCost);

      // Save to history
      for (const gen of newGens) {
        await saveHistory("image", gen, imagePrompt);
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate images.");
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsGenerating(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleGenerateMultiAngle = async (basePrompt: string) => {
    const angles = ["Wide Shot", "Close-up", "Low Angle", "Bird's Eye View"];
    const totalCost = angles.length * IMAGE_GEN_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGeneratingMultiAngle(true);
    setErrorMessage(null);
    setGenerationProgress(0);
    const newResults: string[] = [];

    let progressInterval: any = null;
    try {
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      let referencePart: any = null;
      if (multiAngleImage) {
        const data = await fileToBase64(multiAngleImage);
        referencePart = {
          inlineData: {
            mimeType: multiAngleImage.type,
            data: data || "",
          },
        };
      }

      for (const angle of angles) {
        const response = await withRetry(async () =>
          callGemini(
            "gemini-2.5-flash-image",
            {
              parts: [
                {
                  text: `GENERATE 16:9 CINEMATIC ASSET: ${basePrompt}. Camera Angle: ${angle}. Ensure avatars maintain exact visual continuity with references. Apply a slight cinematic gaussian blur to the background for realistic avatar integration. Format: 16:9 Landscape. Output: PNG.`,
                },
                ...(referencePart ? [referencePart] : []),
              ],
            },
            {
              imageConfig: {
                aspectRatio: "16:9",
                imageSize: "1K",
              },
            },
          ),
        );

        const imagePart = response.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData,
        );
        if (imagePart?.inlineData) {
          const newUrl = await uploadImage(imagePart.inlineData.data);
          newResults.push(newUrl);
        }

        if (angles.indexOf(angle) < angles.length - 1) {
          setGenerationStatus(`Preparing next angle...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setMultiAngleResults(newResults);

      await chargeCredits(totalCost);

      for (const gen of newResults) {
        await saveHistory(
          "image",
          gen,
          `${basePrompt} (${newResults.indexOf(gen)})`,
        );
      }
    } catch (error: any) {
      setErrorMessage(
        error.message || "Failed to generate multi-angle images.",
      );
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsGeneratingMultiAngle(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleGenerateCharacterGen = async () => {
    const poses = [
      "Neutral expression, standing straight, relaxed posture",
      "Arms crossed, looking slightly serious",
      "Slightly annoyed expression, furrowed brow, hands on hips",
      "Happy expression, big smile, friendly posture",
    ];
    const totalCost = poses.length * IMAGE_GEN_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGeneratingCharGen(true);
    setErrorMessage(null);
    setGenerationProgress(0);
    const newResults: string[] = [];

    let progressInterval: any = null;
    try {
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      // 1. Prepare Background
      setGenerationStatus("Preparing background...");
      let bgParts: any[] = [];
      if (charGenGeneratedBgUrl) {
        const data = await fileToBase64(charGenGeneratedBgUrl);
        if (data) bgParts.push({ inlineData: { mimeType: "image/png", data } });
      } else if (charGenBgImages.length > 0) {
        for (const img of charGenBgImages.filter(Boolean)) {
          const data = await fileToBase64(img);
          bgParts.push({
            inlineData: { mimeType: img.type, data: data || "" },
          });
        }
      }

      // 2. Prepare Avatar Reference
      let charParts: any[] = [];
      if (charGenGeneratedCharUrl) {
        const data = await fileToBase64(charGenGeneratedCharUrl);
        if (data)
          charParts.push({ inlineData: { mimeType: "image/png", data } });
      } else if (charGenCharImage) {
        const data = await fileToBase64(charGenCharImage);
        charParts.push({
          inlineData: { mimeType: charGenCharImage.type, data: data || "" },
        });
      }

      // 3. Generate Neutral Pose (Basis for others)
      setGenerationStatus("Generating Neutral Pose (1K)...");
      const neutralResponse = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash-image",
          {
            parts: [
              {
                text: `GENERATE 16:9 1K CINEMATIC ASSET. 
            BACKGROUND: ${charGenBgPrompt || "Consistent with reference"}. 
            AVATAR: ${charGenCharPrompt}. 
            POSE: ${poses[0]}. 
            POSITIONING: The avatar MUST be in a MEDIUM SHOT (waist up), positioned in the RIGHT THIRD of the frame, ${charGenPosition}. 
            Maintain the exact camera distance and framing as shown in professional dealership photography.
            Ensure the background and avatar are perfectly integrated with a slight cinematic gaussian blur on the background. 
            Format: 16:9 Landscape. Resolution: 1K. Output: PNG.`,
              },
              ...bgParts,
              ...charParts,
            ],
          },
          {
            imageConfig: {
              aspectRatio: "16:9",
              imageSize: "1K",
            },
          },
        ),
      );

      const neutralImagePart =
        neutralResponse.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData,
        );
      if (!neutralImagePart?.inlineData)
        throw new Error("Failed to generate the basis image.");

      const neutralUrl = await uploadImage(neutralImagePart.inlineData.data);
      newResults.push(neutralUrl);

      // 4. Generate other 3 poses using Neutral as reference
      for (let i = 1; i < poses.length; i++) {
        setGenerationStatus(
          `Generating ${i === 1 ? "Arms Crossed" : i === 2 ? "Annoyed" : "Happy"} Pose (1K)...`,
        );
        setGenerationProgress(25 + i * 25);

        const poseResponse = await withRetry(async () =>
          callGemini(
            "gemini-2.5-flash-image",
            {
              parts: [
                {
                  text: `GENERATE 16:9 1K CINEMATIC ASSET. 
              MAINTAIN EXACT AVATAR AND BACKGROUND CONSISTENCY FROM REFERENCE. 
              NEW POSE: ${poses[i]}. 
              POSITIONING: The avatar MUST remain in the EXACT SAME POSITION (RIGHT THIRD) and CAMERA DISTANCE (MEDIUM SHOT) as the reference. 
              Apply a slight cinematic gaussian blur to the background for seamless avatar integration.
              Format: 16:9 Landscape. Resolution: 1K. Output: PNG.`,
                },
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: neutralImagePart.inlineData.data,
                  },
                },
              ],
            },
            {
              imageConfig: {
                aspectRatio: "16:9",
                imageSize: "1K",
              },
            },
          ),
        );

        const poseImagePart =
          poseResponse.candidates?.[0]?.content?.parts?.find(
            (p) => p.inlineData,
          );
        if (poseImagePart?.inlineData) {
          const newUrl = await uploadImage(poseImagePart.inlineData.data);
          newResults.push(newUrl);
        }

        if (i < poses.length - 1) {
          setGenerationStatus(`Preparing next pose...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setCharGenResults(newResults);

      // Credits and History
      await chargeCredits(totalCost);

      for (const gen of newResults) {
        await saveHistory(
          "image",
          gen,
          `Avatar Gen: ${charGenCharPrompt} (${newResults.indexOf(gen)})`,
        );
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate avatar set.");
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsGeneratingCharGen(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleGenerateBgOnly = async () => {
    const totalCost = IMAGE_GEN_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGeneratingBg(true);
    setErrorMessage(null);
    try {
      let bgParts: any[] = [];

      // Use generated BG as reference if iterating
      if (charGenGeneratedBgUrl) {
        const data = await fileToBase64(charGenGeneratedBgUrl);
        if (data) bgParts.push({ inlineData: { mimeType: "image/png", data } });
      }

      for (const img of charGenBgImages.filter(Boolean)) {
        const data = await fileToBase64(img);
        bgParts.push({ inlineData: { mimeType: img.type, data: data || "" } });
      }

      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash-image",
          {
            parts: [
              {
                text: `GENERATE 16:9 1K CINEMATIC BACKGROUND ASSET. PROMPT: ${charGenBgPrompt}. Ensure high detail, cinematic lighting, and professional composition. Format: 16:9 Landscape. Resolution: 1K.`,
              },
              ...bgParts,
            ],
          },
          {
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" },
          },
        ),
      );

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      );
      if (imagePart?.inlineData) {
        const newUrl = await uploadImage(imagePart.inlineData.data);
        setCharGenGeneratedBgUrl(newUrl);

        // Save to history
        await saveHistory("image", newUrl, `Avatar Gen BG: ${charGenBgPrompt}`);
      }

      await chargeCredits(totalCost);
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate background.");
    } finally {
      setIsGeneratingBg(false);
    }
  };

  const handleGenerateCharOnly = async () => {
    const totalCost = IMAGE_GEN_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGeneratingChar(true);
    setErrorMessage(null);
    try {
      let charParts: any[] = [];

      // Use generated Char as reference if iterating
      if (charGenGeneratedCharUrl) {
        const data = await fileToBase64(charGenGeneratedCharUrl);
        if (data)
          charParts.push({ inlineData: { mimeType: "image/png", data } });
      }

      if (charGenCharImage) {
        const data = await fileToBase64(charGenCharImage);
        charParts.push({
          inlineData: { mimeType: charGenCharImage.type, data: data || "" },
        });
      }

      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash-image",
          {
            parts: [
              {
                text: `GENERATE 1:1 1K AVATAR ASSET ON A NEUTRAL STUDIO BACKGROUND. AVATAR: ${charGenCharPrompt}. Ensure high detail, consistent features, and a professional medium shot composition. Format: 1:1 Square. Resolution: 1K.`,
              },
              ...charParts,
            ],
          },
          {
            imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
          },
        ),
      );

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      );
      if (imagePart?.inlineData) {
        const newUrl = await uploadImage(imagePart.inlineData.data);
        setCharGenGeneratedCharUrl(newUrl);

        // Save to history
        await saveHistory(
          "image",
          newUrl,
          `Avatar Gen Char: ${charGenCharPrompt}`,
        );
      }

      await chargeCredits(totalCost);
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate avatar.");
    } finally {
      setIsGeneratingChar(false);
    }
  };

  const handleGenerateStoryImage = async (storyPromptIndex: number) => {
    const promptData = storyPrompts[storyPromptIndex];
    if (!promptData) return;

    const totalCost = IMAGE_GEN_COST; // Cost for one image
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationProgress(0);

    let progressInterval: any = null;
    try {
      // Progress simulation
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash-image",
          {
            parts: [
              {
                text: `GENERATE 16:9 CINEMATIC ASSET: ${promptData.prompt}. Ensure avatars maintain exact visual continuity with references. Apply a slight cinematic gaussian blur to the background for realistic avatar integration. Format: 16:9 Landscape. Output: PNG.`,
              },
            ],
          },
          {
            imageConfig: {
              aspectRatio: "16:9",
              imageSize: "1K",
            },
          },
        ),
      );

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      );
      if (imagePart?.inlineData) {
        const newImageUrl = await uploadImage(imagePart.inlineData.data);
        setStoryPrompts((prev) =>
          prev.map((p, i) =>
            i === storyPromptIndex ? { ...p, generatedImage: newImageUrl } : p,
          ),
        );

        // Update credits
        await chargeCredits(totalCost);

        // Save to history
        await saveHistory("image", newImageUrl, promptData.prompt);
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);
    } catch (error: any) {
      setErrorMessage(
        error.message || "Failed to generate image for story prompt.",
      );
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsGenerating(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleGenerateStudioChar = async () => {
    if ((user?.credits || 0) < IMAGE_GEN_COST) {
      setShowLimitModal(true);
      return;
    }
    setIsGeneratingStudioChar(true);
    setGenerationProgress(5);
    const progressInterval = setInterval(() => {
      setGenerationProgress((prev) => Math.min(prev + 5, 90));
    }, 300);
    setErrorMessage(null);
    try {
      console.log("Generating studio character with prompt:", studioCharPrompt);
      const response = await withRetry(async () =>
        callGemini("gemini-2.5-flash-image", studioCharPrompt, {
          imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: imageResolution,
          },
        }),
      );
      console.log("Gemini response:", response);

      const imageParts = response.candidates
        ?.map((c: any) => c.content.parts.find((p: any) => p.inlineData))
        .filter(Boolean);
      console.log("Image parts found:", imageParts);
      if (imageParts && imageParts.length > 0) {
        const newUrls = await Promise.all(
          imageParts.map(
            async (part: any) => await uploadImage(part.inlineData.data),
          ),
        );

        // Use the first one as default
        const res = await fetch(newUrls[0]);
        const blob = await res.blob();
        const file = new File([blob], "character.jpg", { type: "image/jpeg" });

        setStudioCharacterOptions(newUrls);
        setSelectedStudioCharacterIndex(0);
        setStudioCharacter({
          name: studioCharPrompt.split(" ").slice(0, 3).join(" "),
          file,
          url: newUrls[0],
        });

        await chargeCredits(IMAGE_GEN_COST);
        await saveHistory("studio_character", newUrls[0], studioCharPrompt);
        // setStudioMode('framing'); // Remove auto-advance to allow selection
      } else {
        throw new Error("No images generated.");
      }
    } catch (e: any) {
      setErrorMessage(e.message || "Character generation failed.");
    } finally {
      clearInterval(progressInterval);
      setGenerationProgress(100);
      setTimeout(() => setGenerationProgress(0), 1000);
      setIsGeneratingStudioChar(false);
    }
  };

  const handleGenerateStudioFrame = async () => {
    if ((user?.credits || 0) < IMAGE_GEN_COST) {
      setShowLimitModal(true);
      return;
    }
    setIsGeneratingStudioFrame(true);
    setGenerationProgress(5);
    const progressInterval = setInterval(() => {
      setGenerationProgress((prev) => Math.min(prev + 5, 90));
    }, 300);
    setErrorMessage(null);
    try {
      const fullPrompt = `${studioFramePrompt ? studioFramePrompt + ". " : ""}Cinematic frame. ${studioCharPrompt}. Framing: ${studioAngle}, ${studioShotType}. Focal Length: ${studioFocalLength}. Lighting: ${studioLighting}. Camera: ${studioCamera}.`;

      let contents: any[] = [{ role: "user", parts: [{ text: fullPrompt }] }];

      if (studioCharacter.file) {
        const data = await fileToBase64(studioCharacter.file);
        if (data) {
          contents[0].parts.unshift({
            inlineData: { mimeType: studioCharacter.file.type, data },
          });
          contents[0].parts.push({
            text: "Use the provided image as a strict character reference.",
          });
        }
      }

      const response = await withRetry(async () =>
        callGemini("gemini-2.5-flash-image", contents, {
          imageConfig: {
            aspectRatio:
              studioAspectRatio === "9:16"
                ? "9:16"
                : studioAspectRatio === "1:1"
                  ? "1:1"
                  : "16:9",
          },
        }),
      );

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData,
      );
      if (imagePart?.inlineData) {
        const newUrl = await uploadImage(imagePart.inlineData.data);
        setStudioFrameImage(newUrl);
        await chargeCredits(IMAGE_GEN_COST);
        await saveHistory("studio_frame", newUrl, fullPrompt);
        setStudioMode("directing"); // Auto-advance
      } else {
        throw new Error("No frame generated.");
      }
    } catch (e: any) {
      setErrorMessage(e.message || "Frame generation failed.");
    } finally {
      clearInterval(progressInterval);
      setGenerationProgress(100);
      setTimeout(() => setGenerationProgress(0), 1000);
      setIsGeneratingStudioFrame(false);
    }
  };

  const handleGenerateStudio = async () => {
    if ((user?.credits || 0) < VIDEO_COST) {
      setShowLimitModal(true);
      return;
    }

    setIsGeneratingStudio(true);
    setErrorMessage(null);
    setGenerationProgress(0);
    setStudioResult(null);
    setGenerationStatus("Preparing studio production...");
    isCancelledRef.current = false;

    let progressInterval = setInterval(() => {
      setGenerationProgress((prev) => Math.min(prev + 100 / 120, 99)); // ~2 mins
    }, 1000);

    try {
      const fullPrompt = `${studioActionPrompt}. Cinematic video. Framing: ${studioAngle}, ${studioShotType}. Focal Length: ${studioFocalLength}. Lighting: ${studioLighting}. Camera: ${studioCamera}. Transition into shot: ${studioTransition}.`;
      setGenerationStatus("Orchestrating scene with Veo model...");

      let referenceImagePayload: any = undefined;

      if (studioFrameImage) {
        try {
          const res = await fetch(studioFrameImage);
          const blob = await res.blob();
          const file = new File([blob], "frame.jpg", { type: "image/jpeg" });
          const base64Data = await fileToBase64(file);
          if (base64Data) {
            referenceImagePayload = {
              imageBytes: base64Data,
              mimeType: "image/jpeg",
            };
          }
        } catch (e) {
          console.warn("Failed to process studioFrameImage", e);
        }
      } else if (studioCharacter.file) {
        const base64Data = await fileToBase64(studioCharacter.file);
        if (base64Data) {
          referenceImagePayload = {
            imageBytes: base64Data,
            mimeType: studioCharacter.file.type,
          };
        }
      }

      const operation = await withRetry(async () =>
        callGemini(
          "veo-3.1-lite-generate-preview",
          fullPrompt,
          {
            numberOfVideos: 1,
            resolution: studioResolution === "1080p" ? "1080p" : "720p",
            aspectRatio: studioAspectRatio,
            image: referenceImagePayload,
          },
          "video",
        ),
      );

      const operationName = operation?.response?.name;
      if (!operationName)
        throw new Error(
          "Invalid response from video generation: Missing operation name.",
        );

      let currentOp = operation;
      let checkCount = 0;
      setGenerationStatus("Rendering video...");

      while (!currentOp.response?.done) {
        if (isCancelledRef.current)
          throw new Error("Generation cancelled by user.");
        await new Promise((resolve) => setTimeout(resolve, 10000));
        currentOp = await withRetry(async () =>
          callGemini("", operationName, undefined, "operation"),
        );
        checkCount++;
        if (checkCount > 90) {
          // 15 mins
          throw new Error(
            "Video generation timed out. The API might be overloaded.",
          );
        }
      }

      setGenerationProgress(100);
      const downloadLink = 
        (currentOp.response?.generatedVideos?.[0]?.video?.uri || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (currentOp as any).response?.generatedSamples?.[0]?.video?.uri) ||
        currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        (currentOp as any).response?.generatedSamples?.[0]?.video?.uri ||
        (currentOp as any).uri ||
        currentOp.response?.uri;
      if (downloadLink) {
        let finalUrl = downloadLink;
        try {
          let videoRes;
          if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
            videoRes = await fetch(`/api/ai/video-proxy?url=${encodeURIComponent(downloadLink)}`);
          } else {
            const apiKey = (window.aistudio && typeof (window as any).aistudio.getApiKey === "function" ? await (window as any).aistudio.getApiKey() : null) || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
            videoRes = await fetch(downloadLink, {
              headers: { "x-goog-api-key": apiKey },
            });
          }
          const blob = await videoRes.blob();
          finalUrl = URL.createObjectURL(blob);
        } catch (e) {
          console.error("Failed to fetch video blob", e);
        }
        setStudioResult(finalUrl);
        setStudioResultType("video");
        await chargeCredits(VIDEO_COST);
        await saveHistory("studio_video", finalUrl, fullPrompt);
      } else {
        const safetyDetails =
          (currentOp.response?.generatedVideos?.[0]?.video?.videoMetadata || currentOp.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.videoMetadata || (currentOp as any).response?.generatedSamples?.[0]?.video?.videoMetadata)
            ?.safetyDetails;
        if (
          safetyDetails &&
          Object.values(safetyDetails).some((v) => v !== "PASSED")
        ) {
          throw new Error(
            "Production blocked by safety filters. Please adjust the scene components.",
          );
        } else {
          throw new Error("Failed to retrieve generated video URL.");
        }
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate studio production.");
    } finally {
      clearInterval(progressInterval);
      setIsGeneratingStudio(false);
      setTimeout(() => setGenerationProgress(0), 1000);
      setGenerationStatus("");
    }
  };

  const handleGenerateVideo = async () => {
    const totalCost = videoVariations * VIDEO_COST;
    if ((user?.credits || 0) < totalCost) {
      setShowLimitModal(true);
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationProgress(0);

    let progressInterval: any = null;
    try {
      const results: { id: number; url: string }[] = [];

      // Progress simulation
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      for (let i = 0; i < videoVariations; i++) {
        setGenerationStatus(
          `Initializing production for variation ${i + 1}/${videoVariations}...`,
        );
        let operation;

        if (videoFlowAssetMode === "ingredients" || videoMode !== "flow") {
          const refImages = [];
          if (ingredients.character) refImages.push(ingredients.character);
          if (ingredients.style) refImages.push(ingredients.style);
          if (ingredients.setting) refImages.push(ingredients.setting);

          if (refImages.length > 0) {
            setGenerationStatus(
              `Uploading reference assets for variation ${i + 1}...`,
            );
            const referenceImagesPayload: any[] = await Promise.all(
              refImages.map(async (img) => ({
                image: {
                  imageBytes: (await fileToBase64(img)) || "",
                  mimeType: typeof img === "string" ? "image/png" : img.type,
                },
                referenceType: "ASSET",
              })),
            );

            setGenerationStatus(
              `Starting high-fidelity generation for variation ${i + 1}...`,
            );
            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                videoPrompt,
                {
                  numberOfVideos: 1,
                  referenceImages: referenceImagesPayload,
                  resolution: "1080p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          } else {
            // No ingredients, use fast text-to-video
            setGenerationStatus(
              `Starting fast production for variation ${i + 1}...`,
            );
            operation = await withRetry(async () =>
              callGemini(
                "veo-3.1-lite-generate-preview",
                videoPrompt,
                {
                  numberOfVideos: 1,
                  resolution: "720p",
                  aspectRatio: "16:9",
                },
                "video",
              ),
            );
          }
        } else if (videoFlowAssetMode === "frames" && videoMode === "flow") {
          setGenerationStatus(`Analyzing keyframes for variation ${i + 1}...`);
          operation = await withRetry(async () =>
            callGemini(
              "veo-3.1-lite-generate-preview",
              videoPrompt,
              {
                numberOfVideos: 1,
                resolution: "1080p",
                image: framePair.start
                  ? {
                      imageBytes:
                        (await fileToBase64(framePair.start.file)) || "",
                      mimeType:
                        typeof framePair.start.file === "string"
                          ? "image/png"
                          : framePair.start.file?.type || "image/png",
                    }
                  : undefined,
                lastFrame: framePair.end
                  ? {
                      imageBytes:
                        (await fileToBase64(framePair.end.file)) || "",
                      mimeType:
                        typeof framePair.end.file === "string"
                          ? "image/png"
                          : framePair.end.file?.type || "image/png",
                    }
                  : undefined,
                aspectRatio: "16:9",
              },
              "video",
            ),
          );
        } else {
          setGenerationStatus(`Starting production for variation ${i + 1}...`);
          operation = await withRetry(async () =>
            callGemini(
              "veo-3.1-lite-generate-preview",
              videoPrompt,
              {
                numberOfVideos: 1,
                resolution: "720p",
                aspectRatio: "16:9",
              },
              "video",
            ),
          );
        }

        let pollCount = 0;
        const MAX_POLLS = 60; // 60 * 10s = 10 minutes max per video

        while (!operation.done) {
          pollCount++;
          if (pollCount > MAX_POLLS) {
            throw new Error(
              "Video generation timed out after 10 minutes. The API might be overloaded.",
            );
          }

          setGenerationStatus(
            `Processing variation ${i + 1}... (${pollCount * 30}s elapsed)`,
          );
          await new Promise((resolve) => setTimeout(resolve, 30000));

          const nextOp = await withRetry(async () =>
            callGemini("", operation, null, "operation"),
          );
          if (!nextOp) {
            throw new Error("Lost connection to the video generation process.");
          }
          operation = nextOp;
          console.log(`Poll ${pollCount}: done=${operation.done}`, operation.response);
        }

        if (operation.error) {
          throw new Error(
            `Generation failed for variation ${i + 1}: ${operation.error.message || "Unknown error"}`,
          );
        }

        setGenerationStatus(`Finalizing variation ${i + 1}...`);
        const downloadLink =
          (operation.response?.generatedVideos?.[0]?.video?.uri || operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (operation as any).response?.generatedSamples?.[0]?.video?.uri) ||
          operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
          (operation as any).response?.generatedSamples?.[0]?.video?.uri ||
          operation.response?.uri ||
          (operation as any).uri;
          
        console.log("Operation response:", operation.response);
        console.log("Download Link:", downloadLink);
        
        if (downloadLink) {
          let videoRes;
          if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
            videoRes = await fetch(`/api/ai/video-proxy?url=${encodeURIComponent(downloadLink)}`);
          } else {
            const apiKey =
              (window.aistudio && typeof (window as any).aistudio.getApiKey === "function" ? await (window as any).aistudio.getApiKey() : null) || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
            videoRes = await fetch(downloadLink, {
              headers: { "x-goog-api-key": apiKey },
            });
          }
          const blob = await videoRes.blob();
          const url = URL.createObjectURL(blob);
          results.push({ id: Date.now() + i, url });
        } else {
          // Check for safety filters
          const safetyDetails =
            (operation.response?.generatedVideos?.[0]?.video?.videoMetadata || operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.videoMetadata || (operation as any).response?.generatedSamples?.[0]?.video?.videoMetadata)
              ?.safetyDetails;
          if (safetyDetails) {
            throw new Error(
              `Variation ${i + 1} blocked by safety filters. Please refine your prompt.`,
            );
          }
          throw new Error(
            `No video generated for variation ${i + 1}. The API returned an empty response.`,
          );
        }

        if (i < videoVariations - 1) {
          setGenerationStatus(`Preparing next variation...`);
          await new Promise((r) => setTimeout(r, 10000));
        }
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);
      setVideoResults((prev) => [...results.reverse(), ...prev]);

      // Update credits
      await chargeCredits(totalCost);

      // Save to history
      for (const res of results) {
        await saveHistory("video", res.url, videoPrompt);
      }
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate video.");
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsGenerating(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleUpscaleVideo = async (videoId: number, videoUrl: string) => {
    const UPSCALE_COST = 20;
    if ((user?.credits || 0) < UPSCALE_COST) {
      setShowLimitModal(true);
      return;
    }

    setIsUpscaling(true);
    setUpscalingVideoId(videoId);
    setGenerationProgress(0);

    let progressInterval: any = null;
    try {
      // Progress simulation
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      // We use the more powerful model for upscaling
      let operation = await withRetry(async () =>
        callGemini(
          "veo-3.1-lite-generate-preview",
          "Upscale and enhance this video to 1080p high fidelity. Improve textures, lighting, and overall cinematic quality.",
          {
            numberOfVideos: 1,
            resolution: "1080p",
            aspectRatio: "16:9",
          },
          "video",
        ),
      );

      while (!operation.done) {
        await new Promise((resolve) => setTimeout(resolve, 30000));
        operation = await withRetry(async () =>
          callGemini("", operation, null, "operation"),
        );
      }

      clearInterval(progressInterval);
      setGenerationProgress(100);

      const downloadLink = 
        (operation.response?.generatedVideos?.[0]?.video?.uri || operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || (operation as any).response?.generatedSamples?.[0]?.video?.uri) ||
        operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
        (operation as any).response?.generatedSamples?.[0]?.video?.uri ||
        (operation as any).uri ||
        operation.response?.uri;
      if (downloadLink) {
        let videoRes;
        if (!window.aistudio && !process.env.GEMINI_API_KEY && !process.env.API_KEY) {
          videoRes = await fetch(`/api/ai/video-proxy?url=${encodeURIComponent(downloadLink)}`);
        } else {
          const apiKey = (window.aistudio && typeof (window as any).aistudio.getApiKey === "function" ? await (window as any).aistudio.getApiKey() : null) || process.env.API_KEY || process.env.GEMINI_API_KEY || "";
          videoRes = await fetch(downloadLink, {
            headers: { "x-goog-api-key": apiKey },
          });
        }
        const blob = await videoRes.blob();
        const url = URL.createObjectURL(blob);

        setVideoResults((prev) =>
          prev.map((v) => (v.id === videoId ? { ...v, url } : v)),
        );

        // Deduct credits
        await chargeCredits(UPSCALE_COST);
      }
    } catch (error: any) {
      setErrorMessage("Upscaling failed: " + error.message);
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsUpscaling(false);
      setUpscalingVideoId(null);
      setTimeout(() => setGenerationProgress(0), 1000);
      setShowUpscaleMenu(null);
    }
  };

  const handleUpscaleImage = async (
    imageUrl: string,
    resolution: "2K" | "4K" = "4K",
  ) => {
    const IMAGE_UPSCALE_COST = resolution === "4K" ? 10 : 5;
    if ((user?.credits || 0) < IMAGE_UPSCALE_COST) {
      setShowLimitModal(true);
      return;
    }

    setIsUpscaling(true);
    setGenerationProgress(0);

    let progressInterval: any = null;
    try {
      // Progress simulation
      progressInterval = setInterval(() => {
        setGenerationProgress((prev) => {
          if (prev >= 99) return prev;
          return prev + 0.5;
        });
      }, 1000);

      const base64Data = await fileToBase64(imageUrl);
      if (!base64Data)
        throw new Error("Failed to process image for upscaling.");

      const response = await withRetry(async () =>
        callGemini(
          "gemini-2.5-flash-image",
          {
            parts: [
              { inlineData: { data: base64Data, mimeType: "image/png" } },
              {
                text: `Upscale this image to ${resolution} resolution. Enhance all details, textures, and clarity while maintaining the original composition.`,
              },
            ],
          },
          {
            imageConfig: {
              aspectRatio: "16:9",
              imageSize: resolution,
            },
          },
        ),
      );

      clearInterval(progressInterval);
      setGenerationProgress(100);

      const imagePart = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      );
      if (imagePart?.inlineData) {
        const newUrl = await uploadImage(imagePart.inlineData.data);
        setSelectedImage(newUrl);
        setGeneratedImages((prev) =>
          prev.map((img) => (img === imageUrl ? newUrl : img)),
        );

        // Save to history
        await saveHistory("image", newUrl, `Upscaled Image`);

        // Deduct credits
        await chargeCredits(IMAGE_UPSCALE_COST);
      }
    } catch (error: any) {
      setErrorMessage("Image upscaling failed.");
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsUpscaling(false);
      setTimeout(() => setGenerationProgress(0), 1000);
    }
  };

  const handleDownload = async (url: string, name: string) => {
    try {
      let downloadUrl = url;
      let extension = url.startsWith("blob:") ? "mp4" : "png";

      if (url.startsWith("data:")) {
        const res = await fetch(url);
        const blob = await res.blob();
        downloadUrl = URL.createObjectURL(blob);
        // Extract extension from mime type if possible
        const mimeMatch = url.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);/);
        if (mimeMatch) {
          const mime = mimeMatch[1];
          if (mime === "image/jpeg") extension = "jpg";
          else if (mime === "image/png") extension = "png";
          else if (mime === "image/webp") extension = "webp";
          else if (mime === "video/mp4") extension = "mp4";
        }
      } else if (url.startsWith("http") || url.startsWith("/")) {
        const res = await fetch(url);
        const blob = await res.blob();
        downloadUrl = URL.createObjectURL(blob);
        if (res.headers.get("content-type")?.includes("video")) {
          extension = "mp4";
        }
      }

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${name}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (downloadUrl !== url) {
        URL.revokeObjectURL(downloadUrl);
      }
    } catch (error) {
      console.error("Download failed:", error);
      setErrorMessage("Failed to download file.");
    }
  };

  const VideoPlayer = ({
    src,
    className,
  }: {
    src: string;
    className?: string;
  }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(true);
    const [isMuted, setIsMuted] = useState(true);

    const togglePlay = () => {
      if (videoRef.current) {
        if (isPlaying) {
          videoRef.current.pause();
        } else {
          videoRef.current.play();
        }
        setIsPlaying(!isPlaying);
      }
    };

    const toggleMute = () => {
      if (videoRef.current) {
        videoRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
      }
    };

    return (
      <div className={`relative group/player ${className}`}>
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-cover"
          autoPlay
          loop
          muted={isMuted}
          playsInline
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/player:opacity-100 transition-opacity flex items-center justify-center gap-4">
          <button
            onClick={togglePlay}
            className="bg-white/20 backdrop-blur-md border border-white/10 text-white p-4 rounded-full hover:bg-white hover:text-black transition-all active:scale-90 shadow-2xl"
          >
            {isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6 fill-current" />
            )}
          </button>
          <button
            onClick={toggleMute}
            className="bg-white/20 backdrop-blur-md border border-white/10 text-white p-4 rounded-full hover:bg-white hover:text-black transition-all active:scale-90 shadow-2xl"
          >
            {isMuted ? (
              <VolumeX className="w-6 h-6" />
            ) : (
              <Volume2 className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>
    );
  };

  if (authMode !== "app") {
    return (
      <div className="min-h-screen bg-[#050505] text-slate-200 flex items-center justify-center p-6 font-sans relative overflow-hidden">
        {/* Background decorative blob */}
        <div className="absolute top-[10%] left-[20%] w-[60%] h-[60%] bg-pink-600/20 blur-[150px] pointer-events-none rounded-full animate-swirl-top"></div>
        <div className="absolute bottom-[10%] right-[10%] w-[40%] h-[40%] bg-blue-600/20 blur-[150px] pointer-events-none rounded-full animate-swirl-bottom"></div>
        <div className="absolute top-[30%] left-[30%] w-[40%] h-[40%] bg-purple-600/10 blur-[150px] pointer-events-none rounded-full animate-swirl-middle"></div>

        <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in-95 duration-500 relative z-10">
          <div className="text-center space-y-4">
            <img src="/screen2.png" alt="Gener8 Logo" className="h-40 mx-auto mb-6 object-contain" />
            <p className="text-slate-400 text-sm uppercase tracking-[0.3em] font-medium">
              AI Studio Portal
            </p>
          </div>

          <form
            onSubmit={handleEmailAuth}
            className="bg-white/5 backdrop-blur-3xl border border-white/10 p-10 rounded-[2.5rem] shadow-[0_0_50px_rgba(0,0,0,0.5)] space-y-6"
          >
            {errorMessage && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-bold text-center">
                {errorMessage}
              </div>
            )}

            <div className="space-y-4">
              <input
                type="email"
                placeholder="Email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-pink-500/40 transition-all placeholder-slate-600"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-pink-500/40 transition-all placeholder-slate-600"
                required
              />
              <button
                type="submit"
                className="w-full bg-white text-black hover:bg-pink-100 font-bold py-5 rounded-2xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-3"
              >
                Login with Email
              </button>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10"></div>
              </div>
              <div className="relative bg-[#050505] px-4 text-slate-500 text-xs font-bold uppercase tracking-widest">
                or
              </div>
            </div>

            <button
              type="button"
              onClick={handleAuth}
              className="w-full bg-white text-black hover:bg-pink-100 font-bold py-5 rounded-2xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-3"
            >
              Login with Google
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleCreateFolder = async (name: string) => {
    try {
      if (!auth.currentUser) return;
      await addDoc(collection(db, "folders"), {
        uid: auth.currentUser.uid,
        name,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'folders');
      setErrorMessage("Failed to create folder");
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await deleteDoc(doc(db, "folders", folderId));
      // Un-nest files gracefully
      const toUpdate = history.filter((h) => h.folder_id === folderId);
      for (const h of toUpdate) {
        await updateDoc(doc(db, "history", h.id), { folder_id: null });
      }
      if (activeFolder === folderId) setActiveFolder(null);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, 'folders/' + folderId);
      setErrorMessage("Failed to delete folder");
    }
  };

  const handleDropIntoFolder = async (
    historyId: number | string,
    folderId: string | null,
  ) => {
    try {
      await updateDoc(doc(db, "history", historyId.toString()), {
        folder_id: folderId,
      });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'history/' + historyId.toString());
      setErrorMessage("Failed to move item to folder");
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 selection:bg-[#E91E63] selection:text-white flex flex-col font-sans relative overflow-x-hidden">
      {/* Global Background Blobs */}
      <div className="fixed top-[-20%] left-[-10%] w-[60%] h-[60%] bg-pink-600/15 blur-[150px] pointer-events-none rounded-full z-0 animate-swirl-top"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-blue-600/15 blur-[150px] pointer-events-none rounded-full z-0 animate-swirl-bottom"></div>
      <div className="fixed top-[20%] left-[20%] w-[40%] h-[40%] bg-purple-600/10 blur-[150px] pointer-events-none rounded-full z-0 animate-swirl-middle"></div>

      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
          body { font-family: 'Inter', sans-serif; }
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .l-gradient { background: ${LOVY_GRADIENT}; }
          .glass-panel { background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(24px); border: 1px solid rgba(255, 255, 255, 0.1); }
        `}
      </style>

      {(isGenerating || isUpscaling) &&
        generationProgress > 0 /* Global Progress Bar */ && (
          <div className="fixed top-0 left-0 w-full h-1 bg-pink-500/20 z-[1000]">
            <div
              className="h-full bg-pink-500 transition-all duration-300 ease-out"
              style={{ width: `${generationProgress}%` }}
            ></div>
          </div>
        )}

      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-2xl sticky top-0 z-50 px-6 py-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src="/screen2.png" alt="Gener8 Logo" className="h-24 object-contain" />
        </div>

        <div className="flex items-center gap-8">
          <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold uppercase tracking-widest">
            <button
              onClick={() => navigate("/images")}
              className={`transition-all flex items-center gap-2 ${activeTab === "images" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <ImageIcon className="w-4 h-4" /> Images
            </button>
            <button
              onClick={() => navigate("/suite")}
              className={`transition-all flex items-center gap-2 ${activeTab === "suite" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <Video className="w-4 h-4" /> Video Suite
            </button>
            <button
              onClick={() => navigate("/studio")}
              className={`transition-all flex items-center gap-2 ${activeTab === "studio" ? "text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-500 drop-shadow-[0_0_8px_rgba(233,30,99,0.5)]" : "text-slate-500 hover:text-slate-300"}`}
            >
              <Sparkles
                className={`w-4 h-4 ${activeTab === "studio" ? "text-pink-400" : ""}`}
              />{" "}
              Gener8 Studio
            </button>
            <button
              onClick={() => navigate("/history")}
              className={`transition-all flex items-center gap-2 ${activeTab === "history" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
            >
              <RotateCcw className="w-4 h-4" /> History
            </button>
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className={`transition-all flex items-center gap-2 ${activeTab === "admin" ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                <Settings className="w-4 h-4" /> Admin
              </button>
            )}
          </nav>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 bg-slate-900/40 border border-slate-700/50 px-5 py-2.5 rounded-full shadow-inner">
              <Zap className="w-4 h-4 text-[#E91E63] fill-[#E91E63]" />
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-widest text-white leading-none">
                  {Math.floor(user?.credits || 0)}
                </span>
                <span className="text-[7px] text-slate-500 font-black uppercase mt-1">
                  Resets 1st
                </span>
              </div>
              <button
                onClick={() => setShowRequestModal(true)}
                className="ml-2 text-[9px] font-black text-pink-500 border border-pink-500/30 px-2 py-0.5 rounded hover:bg-pink-500 hover:text-white transition-all"
              >
                REQUEST
              </button>
            </div>

            <div className="flex items-center gap-4 group relative">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 overflow-hidden cursor-pointer">
                <div className="text-xs font-bold text-slate-500">
                  {user?.email[0].toUpperCase()}
                </div>
              </div>
              <div className="absolute top-full right-0 pt-2 w-48 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto z-50">
                <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-2xl p-2 shadow-2xl">
                  <div className="px-4 py-2 border-b border-slate-800 mb-2">
                    <p className="text-[10px] text-slate-500 uppercase font-bold truncate">
                      {user?.email}
                    </p>
                    <span className="text-[8px] text-pink-500 font-black uppercase">
                      {user?.role} ACCESS
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all flex items-center gap-2"
                  >
                    <X className="w-3 h-3" /> Logout
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div className="lg:hidden flex border-b border-white/10 bg-black/40 backdrop-blur-2xl sticky top-[73px] z-40 overflow-x-auto no-scrollbar">
        <button
          onClick={() => navigate("/images")}
          className={`flex-none px-6 py-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === "images" ? "text-white border-b-2 border-pink-600 bg-pink-600/5" : "text-slate-500"}`}
        >
          Images
        </button>
        <button
          onClick={() => navigate("/suite")}
          className={`flex-none px-6 py-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === "suite" ? "text-white border-b-2 border-pink-600 bg-pink-600/5" : "text-slate-500"}`}
        >
          Video Suite
        </button>
        <button
          onClick={() => navigate("/studio")}
          className={`flex-none px-6 py-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === "studio" ? "text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-500 border-b-2 border-pink-600 bg-pink-600/5" : "text-slate-500"}`}
        >
          Studio
        </button>
        <button
          onClick={() => navigate("/history")}
          className={`flex-none px-6 py-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === "history" ? "text-white border-b-2 border-pink-600 bg-pink-600/5" : "text-slate-500"}`}
        >
          History
        </button>
        {user?.role === "admin" && (
          <button
            onClick={() => navigate("/admin")}
            className={`flex-none px-6 py-4 text-[11px] font-bold uppercase tracking-widest transition-all ${activeTab === "admin" ? "text-white border-b-2 border-pink-600 bg-pink-600/5" : "text-slate-500"}`}
          >
            Admin
          </button>
        )}
      </div>

      <main className="flex-1 max-w-7xl mx-auto p-4 md:p-8 w-full relative">
        {(isGenerating || isUpscaling) && generationProgress < 100 && (
          <div
            className="fixed inset-x-0 top-0 z-[100] h-1 bg-pink-600 animate-pulse"
            style={{ width: `${generationProgress}%` }}
          ></div>
        )}
        {errorMessage && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-4 animate-in slide-in-from-top-4">
            <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-slate-300 flex-1">
              {errorMessage}
            </p>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-slate-500 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <Routes>
          <Route path="/" element={<Navigate to="/images" replace />} />
          <Route
            path="/images"
            element={
              /* IMAGES SECTION */
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto w-full pb-20">
                {/* Image Mode Switcher */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-1.5 flex gap-1.5 mb-10 shadow-inner max-w-2xl mx-auto overflow-x-auto no-scrollbar">
                  {[
                    { id: "workshop", label: "Workshop", icon: ImageIcon },
                    { id: "story", label: "Story", icon: Layout },
                    { id: "multiAngle", label: "Multi Angle", icon: Camera },
                    { id: "characterGen", label: "Avatar Gen", icon: Sparkles },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setImageMode(mode.id as any)}
                      className={`flex-1 py-3 px-4 rounded-2xl text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 whitespace-nowrap ${imageMode === mode.id ? "bg-white text-black shadow-xl scale-[1.02]" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      <mode.icon className="w-4 h-4" />
                      {mode.label}
                    </button>
                  ))}
                </div>

                {imageMode === "characterGen" ? (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="l-gradient p-3 rounded-2xl shadow-lg">
                        <Sparkles className="text-white w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">
                          Avatar Generator
                        </h2>
                        <p className="text-slate-500 text-sm">
                          Create consistent avatar assets in 4 distinct poses
                          with precise positioning.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
                          {/* Background Section */}
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                                1. Background Setup (Up to 3 Refs)
                              </label>
                              <button
                                onClick={() =>
                                  handleEnhancePrompt(
                                    charGenBgPrompt,
                                    setCharGenBgPrompt,
                                  )
                                }
                                disabled={isEnhancing || !charGenBgPrompt}
                                className="flex items-center gap-2 text-[9px] font-black text-pink-500 border border-pink-500/30 px-3 py-1 rounded-full hover:bg-pink-500 hover:text-white transition-all disabled:opacity-30"
                              >
                                {isEnhancing ? (
                                  <RefreshCcw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3" />
                                )}
                                ENHANCE FOR AUTOMOTIVE
                              </button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {[0, 1, 2].map((idx) => (
                                <div
                                  key={idx}
                                  className="relative border-2 border-dashed border-slate-800 rounded-xl aspect-square flex flex-col items-center justify-center gap-1 hover:border-pink-500/40 transition-all cursor-pointer group overflow-hidden bg-black/40"
                                  onClick={() =>
                                    document
                                      .getElementById(
                                        `chargen-bg-upload-${idx}`,
                                      )
                                      ?.click()
                                  }
                                >
                                  {charGenBgImages[idx] ? (
                                    <div className="relative w-full h-full">
                                      <img
                                        src={URL.createObjectURL(
                                          charGenBgImages[idx],
                                        )}
                                        alt={`BG ${idx}`}
                                        className="w-full h-full object-cover"
                                      />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const newBgs = [...charGenBgImages];
                                          newBgs.splice(idx, 1);
                                          setCharGenBgImages(newBgs);
                                        }}
                                        className="absolute top-1 right-1 bg-black/60 p-1 rounded-full text-white hover:text-red-500"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <Upload className="text-slate-600 w-4 h-4" />
                                  )}
                                  <input
                                    id={`chargen-bg-upload-${idx}`}
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        const newBgs = [...charGenBgImages];
                                        newBgs[idx] = file;
                                        setCharGenBgImages(newBgs);
                                      }
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                            <textarea
                              placeholder="Background prompt..."
                              className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white min-h-[80px] focus:outline-none focus:border-pink-500/40 transition-all resize-none text-xs leading-relaxed"
                              value={charGenBgPrompt}
                              onChange={(e) =>
                                setCharGenBgPrompt(e.target.value)
                              }
                            />

                            {/* Generation Settings */}
                            <div className="space-y-4 pt-4 border-t border-white/10">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                                2. Generation Settings
                              </label>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-[9px] font-bold text-slate-400">Aspect Ratio</label>
                                  <div className="flex bg-white/5 rounded-lg p-1">
                                    {["16:9", "1:1"].map((ratio) => (
                                      <button
                                        key={ratio}
                                        onClick={() => setAspectRatio(ratio as "16:9" | "1:1")}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-md transition-all ${aspectRatio === ratio ? "bg-white text-black" : "text-slate-500 hover:text-white"}`}
                                      >
                                        {ratio}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[9px] font-bold text-slate-400">Resolution</label>
                                  <div className="flex bg-white/5 rounded-lg p-1">
                                    {["1K", "2K", "4K"].map((res) => (
                                      <button
                                        key={res}
                                        onClick={() => setImageResolution(res as "1K" | "2K" | "4K")}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-md transition-all ${imageResolution === res ? "bg-white text-black" : "text-slate-500 hover:text-white"}`}
                                      >
                                        {res}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={handleGenerateBgOnly}
                                disabled={
                                  isGeneratingBg ||
                                  (!charGenBgPrompt &&
                                    charGenBgImages.length === 0)
                                }
                                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                {isGeneratingBg ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCcw className="w-3 h-3" />
                                )}
                                Iterate BG
                              </button>
                              {charGenGeneratedBgUrl && (
                                <button
                                  onClick={() => setCharGenGeneratedBgUrl(null)}
                                  className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            {charGenGeneratedBgUrl && (
                              <div className="relative group aspect-video rounded-xl overflow-hidden border border-pink-500/40 shadow-lg shadow-pink-500/10">
                                <img
                                  src={charGenGeneratedBgUrl}
                                  alt="Generated BG"
                                  className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                                  onClick={() =>
                                    setSelectedImage(charGenGeneratedBgUrl)
                                  }
                                />
                                <div className="absolute top-2 left-2 bg-pink-600 text-white text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-widest">
                                  Selected BG
                                </div>
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        charGenGeneratedBgUrl,
                                        "generated-background",
                                      )
                                    }
                                    className="p-2 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                    title="Download Background"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const response = await fetch(
                                        charGenGeneratedBgUrl,
                                      );
                                      const blob = await response.blob();
                                      const file = new File(
                                        [blob],
                                        "iterated-bg.png",
                                        { type: "image/png" },
                                      );
                                      setCharGenBgImages([file]);
                                      setCharGenGeneratedBgUrl(null);
                                    }}
                                    className="p-2 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                    title="Push to Uploads"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Character Section */}
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                                2. Avatar Setup
                              </label>
                              <button
                                onClick={() =>
                                  handleEnhancePrompt(
                                    charGenCharPrompt,
                                    setCharGenCharPrompt,
                                  )
                                }
                                disabled={isEnhancing || !charGenCharPrompt}
                                className="flex items-center gap-2 text-[9px] font-black text-pink-500 border border-pink-500/30 px-3 py-1 rounded-full hover:bg-pink-500 hover:text-white transition-all disabled:opacity-30"
                              >
                                {isEnhancing ? (
                                  <RefreshCcw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3" />
                                )}
                                ENHANCE FOR AUTOMOTIVE
                              </button>
                            </div>
                            <div
                              className="relative border-2 border-dashed border-slate-800 rounded-2xl p-4 flex flex-col items-center justify-center gap-2 hover:border-pink-500/40 transition-all cursor-pointer group overflow-hidden bg-black/40"
                              onClick={() =>
                                document
                                  .getElementById("chargen-char-upload")
                                  ?.click()
                              }
                            >
                              {charGenCharImage ? (
                                <div className="relative w-full aspect-video rounded-xl overflow-hidden">
                                  <img
                                    src={URL.createObjectURL(charGenCharImage)}
                                    alt="Char"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <RefreshCcw className="text-white w-5 h-5" />
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-2">
                                  <Upload className="text-slate-600 w-5 h-5 mx-auto mb-1" />
                                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                                    Upload Avatar Reference
                                  </p>
                                </div>
                              )}
                              <input
                                id="chargen-char-upload"
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) =>
                                  setCharGenCharImage(
                                    e.target.files?.[0] || null,
                                  )
                                }
                              />
                            </div>
                            <textarea
                              placeholder="Avatar description..."
                              className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white min-h-[80px] focus:outline-none focus:border-pink-500/40 transition-all resize-none text-xs leading-relaxed"
                              value={charGenCharPrompt}
                              onChange={(e) =>
                                setCharGenCharPrompt(e.target.value)
                              }
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleGenerateCharOnly}
                                disabled={
                                  isGeneratingChar ||
                                  (!charGenCharPrompt && !charGenCharImage)
                                }
                                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                {isGeneratingChar ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCcw className="w-3 h-3" />
                                )}
                                Iterate Char
                              </button>
                              {charGenGeneratedCharUrl && (
                                <button
                                  onClick={() =>
                                    setCharGenGeneratedCharUrl(null)
                                  }
                                  className="p-2 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            {charGenGeneratedCharUrl && (
                              <div className="relative group aspect-square w-32 mx-auto rounded-xl overflow-hidden border border-pink-500/40 shadow-lg shadow-pink-500/10">
                                <img
                                  src={charGenGeneratedCharUrl}
                                  alt="Generated Char"
                                  className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                                  onClick={() =>
                                    setSelectedImage(charGenGeneratedCharUrl)
                                  }
                                />
                                <div className="absolute top-1 left-1 bg-pink-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">
                                  Selected Char
                                </div>
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        charGenGeneratedCharUrl,
                                        "generated-avatar",
                                      )
                                    }
                                    className="p-1.5 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                    title="Download Avatar"
                                  >
                                    <Download className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const response = await fetch(
                                        charGenGeneratedCharUrl,
                                      );
                                      const blob = await response.blob();
                                      const file = new File(
                                        [blob],
                                        "iterated-char.png",
                                        { type: "image/png" },
                                      );
                                      setCharGenCharImage(file);
                                      setCharGenGeneratedCharUrl(null);
                                    }}
                                    className="p-1.5 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                    title="Push to Uploads"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Positioning Section */}
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                              3. Positioning
                            </label>
                            <div className="flex gap-4">
                              <button
                                onClick={() => setCharGenPosition("standing")}
                                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${charGenPosition === "standing" ? "bg-white text-black border-white" : "bg-black text-slate-500 border-slate-800 hover:border-slate-600"}`}
                              >
                                Standing
                              </button>
                              <button
                                onClick={() => setCharGenPosition("sitting")}
                                className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${charGenPosition === "sitting" ? "bg-white text-black border-white" : "bg-black text-slate-500 border-slate-800 hover:border-slate-600"}`}
                              >
                                Sitting
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-600 text-center italic">
                              Avatar will be positioned in the right third of
                              the frame.
                            </p>
                          </div>

                          <div className="space-y-4">
                            <button
                              onClick={handleGenerateCharacterGen}
                              disabled={
                                isGeneratingCharGen ||
                                (!charGenBgPrompt &&
                                  charGenBgImages.length === 0 &&
                                  !charGenGeneratedBgUrl) ||
                                (!charGenCharPrompt &&
                                  !charGenCharImage &&
                                  !charGenGeneratedCharUrl)
                              }
                              className="l-gradient text-white font-bold py-5 rounded-2xl w-full shadow-xl hover:scale-[1.01] active:scale-[0.98] transition-all uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 disabled:opacity-50"
                            >
                              {isGeneratingCharGen ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Sparkles className="w-5 h-5" />
                              )}
                              {isGeneratingCharGen
                                ? "Generating Avatar Set..."
                                : `Generate 4 Poses (${IMAGE_GEN_COST * 4} Credits)`}
                            </button>

                            {isGeneratingCharGen && (
                              <div className="space-y-2">
                                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                  <span>{generationStatus}</span>
                                  <span>{Math.round(generationProgress)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                                  <div
                                    className="h-full l-gradient transition-all duration-500"
                                    style={{ width: `${generationProgress}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        {charGenResults.length > 0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {charGenResults.map((url, idx) => (
                              <div
                                key={idx}
                                className="group relative aspect-video bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl"
                              >
                                <img
                                  src={url}
                                  alt={`Pose ${idx}`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                  <button
                                    onClick={() => setSelectedImage(url)}
                                    className="p-3 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleDownload(url, `pose-${idx}`)
                                    }
                                    className="p-3 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                  >
                                    <Download className="w-5 h-5" />
                                  </button>
                                </div>
                                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                                  <span className="text-[8px] font-black text-white uppercase tracking-widest">
                                    {idx === 0
                                      ? "Neutral"
                                      : idx === 1
                                        ? "Arms Crossed"
                                        : idx === 2
                                          ? "Slightly Annoyed"
                                          : "Happy"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="h-full min-h-[500px] border-2 border-dashed border-slate-800 rounded-[2.5rem] flex flex-col items-center justify-center text-slate-600 p-12 text-center">
                            <div className="w-20 h-20 rounded-full bg-slate-900/50 flex items-center justify-center mb-6">
                              <Sparkles className="w-8 h-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-500 uppercase tracking-widest mb-2">
                              Avatar Studio
                            </h3>
                            <p className="text-sm max-w-xs leading-relaxed">
                              Set up your background and avatar to generate a
                              consistent 4-pose asset sheet in 1K resolution.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : imageMode === "multiAngle" ? (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="l-gradient p-3 rounded-2xl shadow-lg">
                        <Camera className="text-white w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">
                          Multi-Angle Generator
                        </h2>
                        <p className="text-slate-500 text-sm">
                          Generate 4 cinematic angles of a single shot for
                          maximum production flexibility.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                              Shot Description
                            </label>
                            <textarea
                              placeholder="Describe the scene in detail (e.g., 'A high-tech laboratory with glowing blue interfaces, a scientist in a white coat working on a holographic display')..."
                              className="w-full bg-black/40 border border-white/10 rounded-2xl p-6 text-white min-h-[160px] focus:outline-none focus:border-pink-500/40 transition-all resize-none text-sm leading-relaxed"
                              value={multiAnglePrompt}
                              onChange={(e) =>
                                setMultiAnglePrompt(e.target.value)
                              }
                            />
                          </div>

                          <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                              Reference Image (Optional)
                            </label>
                            <div
                              className="relative border-2 border-dashed border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 hover:border-pink-500/40 transition-all cursor-pointer group overflow-hidden"
                              onClick={() =>
                                document
                                  .getElementById("multi-angle-upload")
                                  ?.click()
                              }
                            >
                              {multiAngleImage ? (
                                <div className="relative w-full aspect-video rounded-xl overflow-hidden">
                                  <img
                                    src={URL.createObjectURL(multiAngleImage)}
                                    alt="Reference"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <RefreshCcw className="text-white w-6 h-6" />
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Upload className="text-slate-500 w-5 h-5" />
                                  </div>
                                  <div className="text-center">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                                      Upload Reference
                                    </p>
                                    <p className="text-[10px] text-slate-600 mt-1">
                                      Maintain avatar & style consistency
                                    </p>
                                  </div>
                                </>
                              )}
                              <input
                                id="multi-angle-upload"
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) =>
                                  setMultiAngleImage(
                                    e.target.files?.[0] || null,
                                  )
                                }
                              />
                            </div>
                          </div>

                          <button
                            onClick={() =>
                              handleGenerateMultiAngle(multiAnglePrompt)
                            }
                            disabled={
                              isGeneratingMultiAngle || !multiAnglePrompt
                            }
                            className="l-gradient text-white font-bold py-5 rounded-2xl w-full shadow-xl hover:scale-[1.01] active:scale-[0.98] transition-all uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 disabled:opacity-50"
                          >
                            {isGeneratingMultiAngle ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Zap className="w-5 h-5" />
                            )}
                            {isGeneratingMultiAngle
                              ? "Generating Angles..."
                              : `Generate 4 Angles (${IMAGE_GEN_COST * 4} Credits)`}
                          </button>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        {multiAngleResults.length > 0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {multiAngleResults.map((url, idx) => (
                              <div
                                key={idx}
                                className="group relative aspect-video bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl"
                              >
                                <img
                                  src={url}
                                  alt={`Angle ${idx}`}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                                  <button
                                    onClick={() => setSelectedImage(url)}
                                    className="p-3 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleDownload(url, `angle-${idx}`)
                                    }
                                    className="p-3 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                  >
                                    <Download className="w-5 h-5" />
                                  </button>
                                </div>
                                <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                                  <span className="text-[8px] font-black text-white uppercase tracking-widest">
                                    {idx === 0
                                      ? "Wide Shot"
                                      : idx === 1
                                        ? "Close-up"
                                        : idx === 2
                                          ? "Low Angle"
                                          : "Bird's Eye"}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="h-full min-h-[400px] border-2 border-dashed border-slate-800 rounded-[2.5rem] flex flex-col items-center justify-center text-slate-600 p-12 text-center">
                            <div className="w-20 h-20 rounded-full bg-slate-900/50 flex items-center justify-center mb-6">
                              <Camera className="w-8 h-8 opacity-20" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-500 uppercase tracking-widest mb-2">
                              Ready for Action
                            </h3>
                            <p className="text-sm max-w-xs leading-relaxed">
                              Describe your shot and upload an optional
                              reference to generate multiple cinematic
                              perspectives.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : imageMode === "story" ? (
                  /* STORY WORKSHOP */
                  <section className="animate-in fade-in slide-in-from-top-2 duration-500">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      {/* Left Column: Script Input & Controls */}
                      <div className="lg:col-span-5 space-y-6">
                        <div className="glass-panel p-8 rounded-[2.5rem] space-y-6">
                          <div className="flex items-center gap-3 text-pink-500">
                            <Layout className="w-5 h-5" />
                            <h2 className="text-xl font-bold tracking-tight">
                              Context Prompt
                            </h2>
                          </div>
                          <textarea
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-6 text-white focus:outline-none focus:border-pink-500/40 transition-all resize-none text-sm leading-relaxed mb-6"
                            placeholder="Provide additional context or instructions for script creation..."
                            value={storyContextPrompt}
                            onChange={(e) =>
                              setStoryContextPrompt(e.target.value)
                            }
                            disabled={isProcessingStory}
                          ></textarea>

                          <div className="flex items-center gap-3 text-pink-500">
                            <Layout className="w-5 h-5" />
                            <h2 className="text-xl font-bold tracking-tight">
                              Story Script
                            </h2>
                          </div>
                          <textarea
                            className="w-full h-64 bg-black/40 border border-white/10 rounded-2xl p-6 text-white focus:outline-none focus:border-pink-500/40 transition-all resize-none text-sm leading-relaxed"
                            placeholder="Write your cinematic script here..."
                            value={storyScript}
                            onChange={(e) => setStoryScript(e.target.value)}
                            disabled={isProcessingStory}
                          ></textarea>

                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-600 ml-4">
                              Upload Documents (Max 3)
                            </label>
                            <div className="flex items-center gap-4">
                              <input
                                type="file"
                                multiple
                                accept=".txt,.pdf,.md"
                                onChange={(e) =>
                                  setStoryDocuments(
                                    Array.from(e.target.files || []).slice(
                                      0,
                                      3,
                                    ),
                                  )
                                }
                                className="hidden"
                                id="story-doc-upload"
                                disabled={storyDocuments.length >= 3}
                              />
                              <label
                                htmlFor="story-doc-upload"
                                className={`flex-1 text-center bg-white/10 text-white font-bold py-3 rounded-xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 ${storyDocuments.length >= 3 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                <Upload className="w-4 h-4" /> Upload
                              </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {storyDocuments.map((doc, index) => (
                                <div
                                  key={index}
                                  className="bg-slate-800/50 text-white text-xs px-3 py-1 rounded-full flex items-center gap-2"
                                >
                                  {doc.name}
                                  <button
                                    onClick={() =>
                                      setStoryDocuments(
                                        storyDocuments.filter(
                                          (_, i) => i !== index,
                                        ),
                                      )
                                    }
                                    className="text-slate-500 hover:text-white"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <button
                              onClick={handleEnhanceScript}
                              disabled={isProcessingStory || !storyScript}
                              className="flex-1 l-gradient text-white font-bold py-4 rounded-xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessingStory ? (
                                "Enhancing..."
                              ) : (
                                <>
                                  <Sparkles className="w-4 h-4" /> Enhance
                                  Script
                                </>
                              )}
                            </button>
                            <button
                              onClick={handleSubmitStory}
                              disabled={isProcessingStory || !storyScript}
                              className="flex-1 bg-white/10 text-white font-bold py-4 rounded-xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessingStory ? (
                                "Processing..."
                              ) : (
                                <>
                                  <ArrowRight className="w-4 h-4" /> Submit
                                  Story
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Generated Prompts */}
                      <div className="lg:col-span-7 space-y-6">
                        <div className="glass-panel p-8 rounded-[2.5rem] space-y-6">
                          <div className="flex items-center gap-3 text-pink-500">
                            <TypeIcon className="w-5 h-5" />
                            <h2 className="text-xl font-bold tracking-tight">
                              Generated Prompts
                            </h2>
                          </div>
                          {storyPrompts.length > 0 ? (
                            <div className="space-y-4">
                              {storyPrompts.map((item, index) => (
                                <div
                                  key={index}
                                  className="bg-black/40 border border-white/10 rounded-xl p-4 text-white text-sm leading-relaxed space-y-3"
                                >
                                  <div className="flex justify-between items-center mb-2">
                                    <p className="text-slate-500 text-[10px] uppercase font-bold">
                                      Scene {index + 1}
                                    </p>
                                    <button
                                      onClick={() =>
                                        handleEnhanceStoryPrompt(index)
                                      }
                                      disabled={isEnhancing || !item.prompt}
                                      className="flex items-center gap-2 text-[9px] font-black text-pink-500 border border-pink-500/30 px-3 py-1 rounded-full hover:bg-pink-500 hover:text-white transition-all disabled:opacity-30"
                                    >
                                      {isEnhancing ? (
                                        <RefreshCcw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Sparkles className="w-3 h-3" />
                                      )}
                                      ENHANCE PROMPT
                                    </button>
                                  </div>
                                  <p className="text-slate-400 text-xs italic border-l-2 border-slate-700 pl-3 py-1">
                                    From Script: "{item.sourceSegment}"
                                  </p>
                                  <textarea
                                    className="w-full bg-transparent border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-pink-500/40 transition-all resize-y text-sm leading-relaxed"
                                    value={item.prompt}
                                    onChange={(e) =>
                                      setStoryPrompts((prev) =>
                                        prev.map((p, i) =>
                                          i === index
                                            ? { ...p, prompt: e.target.value }
                                            : p,
                                        ),
                                      )
                                    }
                                    rows={3}
                                  ></textarea>
                                  <div className="flex items-center gap-4 mt-4">
                                    <button
                                      onClick={() =>
                                        handleGenerateStoryImage(index)
                                      }
                                      disabled={isGenerating}
                                      className="flex-1 l-gradient text-white font-bold py-3 rounded-xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {isGenerating && !item.generatedImage ? (
                                        <RefreshCcw className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <>
                                          <ImageIcon className="w-4 h-4" />{" "}
                                          {item.generatedImage
                                            ? "Regenerate Image"
                                            : "Generate Image"}
                                        </>
                                      )}
                                    </button>
                                    {item.generatedImage && (
                                      <div className="flex items-center gap-2">
                                        <img
                                          src={item.generatedImage}
                                          alt={`Generated for Scene ${index + 1}`}
                                          className="w-24 h-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                                          onClick={() =>
                                            setSelectedImage(item.generatedImage)
                                          }
                                          referrerPolicy="no-referrer"
                                        />
                                        <button
                                          onClick={() => handleDownload(item.generatedImage!, `scene-${index + 1}`)}
                                          className="p-3 bg-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                                          title="Download Scene Image"
                                        >
                                          <Download className="w-5 h-5" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                              <button
                                onClick={async () => {
                                  for (
                                    let i = 0;
                                    i < storyPrompts.length;
                                    i++
                                  ) {
                                    await handleGenerateStoryImage(i);
                                  }
                                }}
                                disabled={isGenerating}
                                className="w-full l-gradient text-white font-bold py-4 rounded-xl shadow-xl hover:scale-[1.02] transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
                              >
                                <Film className="w-5 h-5" /> Generate Full
                                Storyboard
                              </button>
                              {storyPrompts.some(p => p.generatedImage) && (
                                <button
                                  onClick={async () => {
                                      for (let i = 0; i < storyPrompts.length; i++) {
                                          if (storyPrompts[i].generatedImage) {
                                              await handleDownload(storyPrompts[i].generatedImage!, `storyboard-scene-${i+1}`);
                                          }
                                      }
                                  }}
                                  className="w-full mt-4 bg-white/10 hover:bg-white text-slate-300 hover:text-black font-bold py-3 rounded-xl shadow-xl transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2"
                                >
                                  <Download className="w-4 h-4" /> Download All Generated Scenes
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="text-slate-500 text-center py-12 border border-dashed border-slate-800 rounded-2xl">
                              <p>Submit a script to generate image prompts.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  /* IMAGES WORKSHOP */
                  <section className="animate-in fade-in slide-in-from-top-2 duration-500">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden group">
                          <div className="absolute top-0 left-0 w-full h-1 l-gradient opacity-20"></div>
                          <h2 className="text-2xl font-bold text-white mb-6 tracking-tight">
                            Image Production
                          </h2>

                          <div className="space-y-4 mb-8">
                            <div className="flex justify-between items-center mb-1">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                Reference Library
                              </label>
                              <span className="text-[10px] font-mono text-slate-600">
                                {imageReferences.length}/5
                              </span>
                            </div>
                            <div className="grid grid-cols-5 gap-3">
                              {imageReferences.map((img, idx) => (
                                <div
                                  key={idx}
                                  onClick={() => setSelectedImage(img.preview)}
                                  className="relative aspect-video rounded-xl overflow-hidden border border-slate-700 bg-black shadow-lg group block cursor-pointer"
                                >
                                  <img
                                    src={img.preview}
                                    alt="ref"
                                    className="w-full h-full object-cover opacity-60"
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setImageReferences((prev) =>
                                        prev.filter((_, i) => i !== idx),
                                      );
                                    }}
                                    className="absolute top-1 right-1 bg-black/80 rounded-full p-1 lg:opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <X className="w-2.5 h-2.5 text-white" />
                                  </button>
                                </div>
                              ))}
                              {imageReferences.length < 5 && (
                                <label className="aspect-video rounded-xl border border-dashed border-slate-700 flex items-center justify-center cursor-pointer hover:border-pink-500/50 transition-all bg-slate-900/30">
                                  <Plus className="w-5 h-5 text-slate-600" />
                                  <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleImageRefUpload}
                                    accept="image/*"
                                  />
                                </label>
                              )}
                            </div>
                          </div>

                          <div className="space-y-4 mb-8">
                            <div className="flex justify-between items-center">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                Visual Script
                              </label>
                              <button
                                onClick={() =>
                                  handleEnhancePrompt(
                                    imagePrompt,
                                    setImagePrompt,
                                  )
                                }
                                disabled={isEnhancing || !imagePrompt}
                                className="flex items-center gap-2 text-[9px] font-black text-pink-500 border border-pink-500/30 px-3 py-1 rounded-full hover:bg-pink-500 hover:text-white transition-all disabled:opacity-30"
                              >
                                {isEnhancing ? (
                                  <RefreshCcw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Sparkles className="w-3 h-3" />
                                )}
                                ENHANCE FOR AUTOMOTIVE
                              </button>
                            </div>
                            <textarea
                              value={imagePrompt}
                              onChange={(e) => setImagePrompt(e.target.value)}
                              placeholder="Describe the cinematic scene..."
                              className="w-full h-40 bg-[#0A0A0A] border border-slate-800 rounded-2xl p-5 text-slate-200 focus:outline-none focus:border-pink-500/40 transition-all resize-none text-base leading-relaxed"
                            />
                          </div>

                          <div className="space-y-8">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 block mb-4">
                                Batch Size
                              </label>
                              <div className="flex bg-slate-900/50 rounded-2xl p-1.5 border border-slate-800">
                                {[1, 2, 3, 4].map((num) => (
                                  <button
                                    key={num}
                                    onClick={() => setImageVariations(num)}
                                    className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all ${imageVariations === num ? "bg-white text-black shadow-lg" : "text-slate-500 hover:text-white"}`}
                                  >
                                    {num}
                                  </button>
                                ))}
                              </div>
                            </div>
                            
                            {/* Generation Settings */}
                            <div className="space-y-4 pt-4 border-t border-white/10">
                              <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                                2. Generation Settings
                              </label>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="text-[9px] font-bold text-slate-400">Aspect Ratio</label>
                                  <div className="flex bg-white/5 rounded-lg p-1">
                                    {["16:9", "1:1"].map((ratio) => (
                                      <button
                                        key={ratio}
                                        onClick={() => setAspectRatio(ratio as "16:9" | "1:1")}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-md transition-all ${aspectRatio === ratio ? "bg-white text-black" : "text-slate-500 hover:text-white"}`}
                                      >
                                        {ratio}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[9px] font-bold text-slate-400">Resolution</label>
                                  <div className="flex bg-white/5 rounded-lg p-1">
                                    {["1K", "2K", "4K"].map((res) => (
                                      <button
                                        key={res}
                                        onClick={() => setImageResolution(res as "1K" | "2K" | "4K")}
                                        className={`flex-1 py-2 text-[10px] font-bold rounded-md transition-all ${imageResolution === res ? "bg-white text-black" : "text-slate-500 hover:text-white"}`}
                                      >
                                        {res}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => handleGenerateImages(imagePrompt, aspectRatio, imageResolution)}
                              disabled={isGenerating || !imagePrompt}
                              style={{
                                background: isGenerating
                                  ? "#1A1A1A"
                                  : LOVY_GRADIENT,
                              }}
                              className="w-full text-white font-bold py-5 rounded-[1.25rem] flex items-center justify-center gap-3 transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 uppercase tracking-[0.15em] text-xs shadow-xl"
                            >
                              {isGenerating ? (
                                <RefreshCcw className="w-5 h-5 animate-spin" />
                              ) : (
                                <>
                                  <Camera className="w-5 h-5" />
                                  Produce Assets
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        {(isGenerating || isUpscaling) &&
                          generationProgress > 0 && (
                            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-lg animate-in fade-in duration-300">
                              <div className="w-full max-w-md bg-white/5 backdrop-blur-3xl border border-white/10 p-8 rounded-3xl shadow-2xl space-y-4 text-center">
                                <p className="text-sm font-bold uppercase tracking-widest text-pink-500 animate-pulse">
                                  {isUpscaling ? "Upscaling" : "Generating"}...
                                </p>
                                <div className="w-full bg-slate-800 rounded-full h-2.5">
                                  <div
                                    className="l-gradient h-2.5 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${generationProgress}%` }}
                                  ></div>
                                </div>
                                <p className="text-xs text-slate-500">
                                  {Math.floor(generationProgress)}% Complete
                                </p>
                              </div>
                            </div>
                          )}

                        <div
                          className={`grid gap-6 ${generatedImages.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}
                        >
                          {generatedImages.length > 0 ? (
                            generatedImages.map((src, i) => (
                              <div
                                key={i}
                                onClick={() => setSelectedImage(src)}
                                className="block group relative bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden aspect-video shadow-2xl animate-in zoom-in-95 duration-700 cursor-pointer"
                              >
                                <img
                                  src={src}
                                  alt="Gen"
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Wand2 className="w-10 h-10 text-white" />
                                </div>
                                <div className="absolute top-5 left-5 lg:opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      iterateOnImage(src);
                                    }}
                                    className="bg-black/60 backdrop-blur-md border border-white/10 text-white px-4 py-2.5 rounded-full hover:bg-white hover:text-black transition-all shadow-2xl flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                                  >
                                    <RotateCcw className="w-4 h-4" /> Use as
                                    Reference
                                  </button>
                                </div>

                                <div className="absolute bottom-5 right-5 lg:opacity-0 group-hover:opacity-100 transition-all transform -translate-y-2 group-hover:translate-y-0 flex gap-3">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownload(src, `gener8-img-${i}`);
                                    }}
                                    className="bg-white/10 backdrop-blur-md border border-white/10 text-white p-3.5 rounded-full hover:bg-white hover:text-black transition-all active:scale-90 shadow-2xl"
                                  >
                                    <Download className="w-5 h-5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="aspect-video bg-[#0B0B0B] border border-slate-800 border-dashed rounded-[2.5rem] flex flex-col items-center justify-center text-slate-700 p-12 text-center group">
                              <div className="w-20 h-20 rounded-full bg-slate-900/50 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                <ImageIcon className="w-10 h-10 opacity-20" />
                              </div>
                              <p className="text-lg font-semibold uppercase tracking-[0.2em] opacity-30">
                                Production Stage
                              </p>
                              <p className="text-sm mt-3 italic opacity-20">
                                AI Production engine ready for directional cues
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            }
          />
          
          <Route
            path="/suite"
            element={
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-7xl mx-auto w-full pb-20">
                {/* Video Mode Switcher */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-1.5 flex gap-1.5 mb-10 shadow-inner max-w-sm mx-auto overflow-x-auto no-scrollbar">
                  {[
                    { id: "flow", label: "Video Flow", icon: Video },
                    { id: "automator", label: "Automator", icon: List },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setVideoMode(mode.id as any)}
                      className={`flex-1 py-3 px-4 rounded-2xl text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 whitespace-nowrap ${videoMode === mode.id ? "bg-white text-black shadow-xl scale-[1.02]" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      <mode.icon className="w-4 h-4" />
                      {mode.label}
                    </button>
                  ))}
                </div>

                {videoMode === "flow" ? (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="l-gradient p-3 rounded-2xl shadow-lg">
                        <Video className="text-white w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">
                          Video Generation Flow
                        </h2>
                        <p className="text-slate-500 text-sm">
                          Direct high-quality clips using references or keyframes.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
                          <div className="flex gap-2">
                             <button
                               onClick={() => setVideoFlowAssetMode("ingredients")}
                               className={`flex-1 py-2 text-xs font-bold uppercase transition-all border-b-2 ${videoFlowAssetMode === "ingredients" ? "border-pink-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
                             >
                               Ingredients
                             </button>
                             <button
                               onClick={() => setVideoFlowAssetMode("frames")}
                               className={`flex-1 py-2 text-xs font-bold uppercase transition-all border-b-2 ${videoFlowAssetMode === "frames" ? "border-pink-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
                             >
                               Frame to Frame
                             </button>
                          </div>

                          {videoFlowAssetMode === "ingredients" ? (
                             <div className="space-y-4">
                               {["character", "style", "setting"].map((key) => {
                                 const val = ingredients[key as keyof typeof ingredients];
                                 return (
                                   <div key={key} className="flex gap-4 items-center">
                                      <div className="w-24 h-24 rounded-xl border border-dashed border-slate-600 flex items-center justify-center overflow-hidden bg-black/50">
                                         {val ? (
                                           <img src={typeof val === "string" ? val : URL.createObjectURL(val)} className="w-full h-full object-cover" />
                                         ) : (
                                           <ImageIcon className="w-6 h-6 text-slate-600" />
                                         )}
                                      </div>
                                      <div className="flex-1">
                                        <p className="text-sm font-bold text-slate-300 capitalize">{key}</p>
                                        <p className="text-xs text-slate-500 mb-2">Reference image</p>
                                        <input type="file" className="text-xs text-slate-400" accept="image/*" onChange={(e) => {
                                          if (e.target.files?.[0]) {
                                             setIngredients(prev => ({...prev, [key]: e.target.files![0]}));
                                          }
                                        }} />
                                      </div>
                                      {val && (
                                        <button onClick={() => setIngredients(prev => ({...prev, [key]: null}))} className="p-2 text-slate-500 hover:text-red-400">
                                          <X className="w-4 h-4" />
                                        </button>
                                      )}
                                   </div>
                                 );
                               })}
                             </div>
                          ) : (
                             <div className="space-y-4">
                               {["start", "end"].map((key) => {
                                 const val = framePair[key as keyof typeof framePair];
                                 return (
                                   <div key={key} className="flex gap-4 items-center">
                                      <div className="w-32 h-20 rounded-xl border border-dashed border-slate-600 flex items-center justify-center overflow-hidden bg-black/50">
                                         {val ? (
                                           <img src={typeof val === "string" ? val : URL.createObjectURL(val)} className="w-full h-full object-cover" />
                                         ) : (
                                           <ImageIcon className="w-6 h-6 text-slate-600" />
                                         )}
                                      </div>
                                      <div className="flex-1">
                                        <p className="text-sm font-bold text-slate-300 capitalize">{key} Frame</p>
                                        <input type="file" className="text-xs text-slate-400 mt-2" accept="image/*" onChange={(e) => {
                                          if (e.target.files?.[0]) {
                                             setFramePair(prev => ({...prev, [key]: e.target.files![0]}));
                                          }
                                        }} />
                                      </div>
                                      {val && (
                                        <button onClick={() => setFramePair(prev => ({...prev, [key]: null}))} className="p-2 text-slate-500 hover:text-red-400">
                                          <X className="w-4 h-4" />
                                        </button>
                                      )}
                                   </div>
                                 );
                               })}
                             </div>
                          )}

                          <div className="space-y-4 pt-4 border-t border-white/10">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                              Action & Motion Prompt
                            </label>
                            <textarea
                              value={videoPrompt}
                              onChange={(e) => setVideoPrompt(e.target.value)}
                              placeholder="Describe the action, camera movement, and evolution of the scene..."
                              className="w-full h-32 bg-black/50 border border-white/10 rounded-2xl p-4 text-sm text-slate-200 focus:outline-none focus:border-pink-500/50 resize-none transition-colors"
                            />
                          </div>
                          
                          <button
                            onClick={handleGenerateVideo}
                            disabled={isGenerating || !videoPrompt}
                            className="w-full group relative overflow-hidden rounded-2xl bg-white text-black p-4 font-bold text-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                          >
                            <span className="relative z-10 flex items-center justify-center gap-2">
                              {isGenerating ? (
                                <>
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  Rendering Scene...
                                </>
                              ) : (
                                <>
                                  <Video className="w-5 h-5" />
                                  Action
                                </>
                              )}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        <div className="bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] p-4 lg:p-8 min-h-[600px] flex flex-col shadow-2xl relative overflow-hidden">
                           {!isGenerating && videoResults.length === 0 ? (
                             <div className="flex-1 flex flex-col items-center justify-center text-center max-w-sm mx-auto space-y-6">
                                <Video className="w-16 h-16 text-slate-800" />
                                <div>
                                  <p className="text-slate-400 text-lg mb-2">Stage Ready</p>
                                  <p className="text-slate-600 text-sm">Add inputs or prompts and hit Action to synthesize your shot.</p>
                                </div>
                             </div>
                           ) : (
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                               {videoResults.map((v, i) => (
                                 <div key={i} className="aspect-video bg-black rounded-xl overflow-hidden shadow-lg group relative">
                                    <video src={v.url} controls autoPlay loop className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                                       <button onClick={() => {
                                          const a = document.createElement("a");
                                          a.href = v.url;
                                          a.download = `video-${Date.now()}.mp4`;
                                          a.click();
                                       }} className="p-3 bg-white/20 hover:bg-white text-white hover:text-black rounded-full backdrop-blur-md transition-colors">
                                          <Download className="w-5 h-5" />
                                       </button>
                                       <button onClick={() => setSelectedImage(v.url)} className="p-3 bg-white/20 hover:bg-white text-white hover:text-black rounded-full backdrop-blur-md transition-colors">
                                          <Maximize2 className="w-5 h-5" />
                                       </button>
                                    </div>
                                 </div>
                               ))}
                             </div>
                           )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-4 mb-8">
                      <div className="l-gradient p-3 rounded-2xl shadow-lg">
                        <List className="text-white w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">
                          Batch Automator
                        </h2>
                        <p className="text-slate-500 text-sm">
                          Generate multiple clips from a list of prompts.
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 space-y-6 shadow-2xl max-w-3xl mx-auto">
                        {/* References */}
                        <div className="space-y-4">
                          <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                            Reference Images (Up to 5)
                          </label>
                          <div className="flex gap-4 overflow-x-auto pb-4">
                            {automatorReferences.map((ref, i) => (
                              <div key={i} className="relative w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden border border-white/10 group">
                                <img src={ref.preview} className="w-full h-full object-cover" />
                                <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center text-[10px] font-medium text-white truncate backdrop-blur-md">
                                  Image {i + 1}
                                </div>
                                <button 
                                  onClick={() => setAutomatorReferences(prev => prev.filter((_, idx) => idx !== i))}
                                  className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            {automatorReferences.length < 5 && (
                              <label className="w-24 h-24 flex-shrink-0 cursor-pointer rounded-2xl border border-dashed border-white/20 flex flex-col items-center justify-center bg-white/5 hover:bg-white/10 transition-colors">
                                <Upload className="w-5 h-5 text-slate-400 mb-1" />
                                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Upload</span>
                                <input 
                                  type="file" 
                                  className="hidden" 
                                  accept="image/*" 
                                  onChange={(e) => {
                                    if (e.target.files?.[0]) {
                                      const file = e.target.files[0];
                                      setAutomatorReferences(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
                                    }
                                  }} 
                                />
                              </label>
                            )}
                          </div>
                        </div>

                        {/* List of Clips */}
                        <div className="space-y-4 pt-4 border-t border-white/10">
                           <div className="flex justify-between items-center">
                             <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 ml-1">
                                Script / Scene List
                             </label>
                             <button
                               onClick={() => setAutomatorClips(prev => [...prev, { prompt: "", status: "pending", referenceSelection: null }])}
                               className="text-[10px] font-bold uppercase tracking-widest text-pink-400 hover:text-pink-300 flex items-center gap-1"
                             >
                               <Plus className="w-3 h-3" /> Add Scene
                             </button>
                           </div>
                           <div className="space-y-3 max-h-96 overflow-y-auto pr-2 no-scrollbar">
                             {automatorClips.map((clip, idx) => (
                               <div key={idx} className="flex gap-3 items-start bg-black/30 p-3 rounded-2xl border border-white/10">
                                 <textarea
                                   value={clip.prompt}
                                   onChange={(e) => setAutomatorClips(prev => prev.map((c, i) => i === idx ? { ...c, prompt: e.target.value } : c))}
                                   placeholder="Action or dialogue..."
                                   className="flex-1 h-16 bg-transparent border-none text-sm text-slate-200 focus:outline-none resize-none"
                                 />
                                 <div className="w-32 flex flex-col gap-2">
                                   <select
                                     value={clip.referenceSelection === null ? "" : clip.referenceSelection}
                                     onChange={(e) => setAutomatorClips(prev => prev.map((c, i) => i === idx ? { ...c, referenceSelection: e.target.value === "" ? null : parseInt(e.target.value) } : c))}
                                     className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-slate-300 focus:outline-none focus:border-pink-500 *:bg-[#111]"
                                   >
                                     <option value="">No Reference</option>
                                     {automatorReferences.map((ref, i) => (
                                       <option key={i} value={i}>Image {i + 1}</option>
                                     ))}
                                   </select>
                                   <button
                                     onClick={() => setAutomatorClips(prev => prev.filter((_, i) => i !== idx))}
                                     className="w-full py-1.5 text-[10px] text-red-400/50 hover:text-red-400 uppercase font-bold tracking-widest transition-colors text-center border border-transparent hover:border-red-500/20 rounded-lg"
                                   >
                                     Remove
                                   </button>
                                 </div>
                               </div>
                             ))}
                             {automatorClips.length === 0 && (
                               <div className="text-center py-8 text-sm text-slate-500 bg-black/20 rounded-2xl border border-dashed border-white/10">
                                 No scenes added yet. Click "Add Scene" to start building your script.
                               </div>
                             )}
                           </div>
                        </div>
                        
                        <button
                          onClick={handleStartAutomation}
                          disabled={automatorStatus !== "idle" || automatorClips.length === 0}
                          className="w-full group relative overflow-hidden rounded-2xl bg-white text-black p-4 font-bold text-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                        >
                           <span className="relative z-10 flex items-center justify-center gap-2">
                             {automatorStatus !== "idle" ? (
                               <>
                                 <Loader2 className="w-5 h-5 animate-spin" />
                                 Processing...
                               </>
                             ) : (
                               <>
                                 <List className="w-5 h-5" />
                                 Run Automator
                               </>
                             )}
                           </span>
                        </button>
                    </div>

                    {automatorClips.length > 0 && (
                      <div className="mt-12 bg-[#0A0A0B] border border-white/10 rounded-[2.5rem] p-8 shadow-2xl">
                         <h3 className="text-xl font-bold mb-6">Generated Clips</h3>
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {automatorClips.map((clip, i) => (
                              <div key={i} className="flex flex-col gap-2">
                                <div className="aspect-video bg-black rounded-xl overflow-hidden relative">
                                   {clip.status === "completed" && clip.url ? (
                                      <video src={clip.url} controls loop className="w-full h-full object-cover" />
                                   ) : clip.status === "error" ? (
                                      <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/20 text-red-400 p-4 text-center">
                                         <AlertCircle className="w-6 h-6 mb-2" />
                                         <span className="text-xs">{clip.error || "Failed"}</span>
                                      </div>
                                   ) : (
                                      <div className="w-full h-full flex items-center justify-center text-slate-500">
                                         <Loader2 className="w-6 h-6 animate-spin" />
                                      </div>
                                   )}
                                </div>
                                <p className="text-xs text-slate-400 line-clamp-2">{clip.prompt}</p>
                              </div>
                            ))}
                         </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            }
          />
          <Route
            path="/studio"
            element={
              <div className="h-[calc(100vh-4rem)] w-full relative">
                <React.Suspense fallback={<div className="h-full w-full flex items-center justify-center">Loading Data...</div>}>
                  <StudioNodeEditor
                    onGenerateImage={handleGenerateImages}
                    onGenerateVideo={handleGenerateVideo}
                  />
                </React.Suspense>
              </div>
            }
          />
          <Route
            path="/admin"
            element={
              /* ADMIN DASHBOARD */
              <section className="animate-in fade-in slide-in-from-top-2 duration-500 space-y-12">
                <div className="text-center">
                  <h2 className="text-4xl font-bold text-white tracking-tighter uppercase mb-4">
                    Studio Administration
                  </h2>
                  <p className="text-slate-500 text-sm italic">
                    Manage users, allowances, and credit requests
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Site Health Monitoring */}
                  <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl space-y-8 lg:col-span-2">
                    <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-pink-500">
                      System Health Monitor
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div className="bg-black/40 p-6 rounded-2xl border border-white/10">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          Active Users
                        </p>
                        <p className="text-2xl font-bold text-white mt-1">
                          {siteHealth.activeUsers}
                        </p>
                      </div>
                      <div className="bg-black/40 p-6 rounded-2xl border border-white/10">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          Generations (24h)
                        </p>
                        <p className="text-2xl font-bold text-white mt-1">
                          {siteHealth.dailyGenerations}
                        </p>
                      </div>
                      <div className="bg-black/40 p-6 rounded-2xl border border-white/10">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          System Status
                        </p>
                        <p
                          className={`text-xl font-bold mt-1 ${siteHealth.systemStatus === "Optimal" ? "text-green-500" : "text-amber-500"}`}
                        >
                          {siteHealth.systemStatus}
                        </p>
                      </div>
                      <div className="bg-black/40 p-6 rounded-2xl border border-white/10">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          Bottlenecks
                        </p>
                        <ul className="text-xs text-red-400 mt-2 space-y-1">
                          {siteHealth.apiBottlenecks.map(
                            (b: string, i: number) => (
                              <li key={i}>• {b}</li>
                            ),
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* User Management */}
                  <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl space-y-8">
                    <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-pink-500">
                      Create New Studio Account
                    </h3>
                    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if(!newUserEmail || !newUserPassword) return;
      try {
        const { getApps, initializeApp } = await import('firebase/app');
        const { getAuth, createUserWithEmailAndPassword, signOut } = await import('firebase/auth');
        // Retrieve config
        const firebaseConfig = {
          projectId: process.env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0185987639", // fallback
          appId: "1:835175473514:web:16ae7b2526d5eb1d63c513", // from firebase-applet-config
          apiKey: "AIzaSyDAMoCZu81rQk0aKEDq-_9AKON6C4xL6f0",
          authDomain: "gen-lang-client-0185987639.firebaseapp.com",
        };
        
        const apps = getApps();
        let secondaryApp = apps.find(a => a.name === "Secondary");
        if (!secondaryApp) {
          secondaryApp = initializeApp(db.app.options, "Secondary");
        }
        const secondaryAuth = getAuth(secondaryApp);
        
        setGenerationStatus("Creating user...");
        const cred = await createUserWithEmailAndPassword(secondaryAuth, newUserEmail, newUserPassword);
        
        try {
          await setDoc(doc(db, "users", cred.user.uid), {
            email: newUserEmail,
            credits: newUserAllowance,
            monthly_allowance: newUserAllowance,
            tier: "Standard",
            role: "user",
            last_reset_date: new Date().toISOString().substring(0, 7),
          });
        } catch(setDocErr) {
          handleFirestoreError(setDocErr, OperationType.WRITE, 'users/' + cred.user.uid);
        }
        
        await signOut(secondaryAuth);
        
        setNewUserEmail("");
        setNewUserPassword("");
        setNewUserAllowance(100);
        alert("User created successfully");
        setGenerationStatus("");
      } catch (err: any) {
        alert("Error creating user: " + err.message);
        setGenerationStatus("");
      }
  }}>
                      <input
                        type="email"
                        placeholder="Client Email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm"
                        required
                      />
                      <input
                        type="password"
                        placeholder="Initial Password"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm"
                        required
                      />
                      <div className="space-y-2">
                        <label className="text-[9px] font-bold text-slate-600 uppercase tracking-widest ml-2">
                          Monthly Allowance
                        </label>
                        <input
                          type="number"
                          value={newUserAllowance}
                          onChange={(e) =>
                            setNewUserAllowance(Number(e.target.value))
                          }
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full l-gradient text-white font-bold py-4 rounded-xl uppercase tracking-widest text-[10px]"
                      >
                        Provision Account
                      </button>
                    </form>

                    <div className="pt-8 border-t border-slate-800">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">
                          Studio Capacity
                        </h3>
                        <span className="text-[10px] font-mono text-slate-600">
                          {adminUsers.length}/100
                        </span>
                      </div>
                      <button
                        onClick={() => setShowUsersModal(true)}
                        className="w-full bg-white/5 backdrop-blur-xl border border-white/10 text-slate-300 font-bold py-4 rounded-xl uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                      >
                        <Layers className="w-4 h-4" />
                        View Active Accounts
                      </button>
                    </div>
                  </div>

                  {/* Credit Requests */}
                  <div className="bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-8 shadow-2xl space-y-8">
                    <h3 className="text-xs font-bold uppercase tracking-[0.3em] text-pink-500">
                      Pending Credit Requests
                    </h3>
                    <div className="space-y-4">
                      {adminRequests.length > 0 ? (
                        adminRequests.map((r) => (
                          <div
                            key={r.id}
                            className="flex justify-between items-center p-6 bg-black/40 rounded-2xl border border-pink-500/10"
                          >
                            <div>
                              <p className="text-xs font-bold text-white">
                                {r.email}
                              </p>
                              <p className="text-[10px] text-pink-500 font-bold uppercase tracking-widest">
                                Requesting {r.amount} Credits
                              </p>
                            </div>
                            <button
                              onClick={() => handleApproveRequest(r.id)}
                              className="bg-white text-black font-bold px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest hover:bg-pink-500 hover:text-white transition-all"
                            >
                              Approve
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center text-slate-700 italic text-sm">
                          No pending requests
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            }
          />
          <Route
            path="/history"
            element={
              /* PRODUCTION HISTORY */
              <section className="animate-in fade-in slide-in-from-top-2 duration-500">
                <div className="mb-12 text-center">
                  <h2 className="text-4xl font-bold text-white tracking-tighter uppercase mb-4">
                    Production Archives
                  </h2>
                  <p className="text-slate-500 text-sm italic">
                    Historical record of all Gener8 cinematic assets
                  </p>
                </div>

                <div className="flex flex-col lg:flex-row gap-8 items-start">
                  {/* Folders Sidebar */}
                  <div className="w-full lg:w-64 shrink-0 flex flex-col gap-3 sticky top-8">
                    <button
                      onClick={() => setActiveFolder("all")}
                      className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${activeFolder === "all" ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"}`}
                    >
                      <Film className="w-5 h-5 shrink-0" />
                      <span className="text-xs font-bold uppercase tracking-widest flex-1">
                        All Archives
                      </span>
                      <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded-full">
                        {history.length}
                      </span>
                    </button>

                    <button
                      onClick={() => setActiveFolder(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add("border-pink-500");
                      }}
                      onDragLeave={(e) =>
                        e.currentTarget.classList.remove("border-pink-500")
                      }
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove("border-pink-500");
                        const itemId = e.dataTransfer.getData("itemId");
                        if (itemId) handleDropIntoFolder(itemId, null);
                      }}
                      className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${activeFolder === null ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"}`}
                    >
                      <FolderOpen className="w-5 h-5 shrink-0" />
                      <span className="text-xs font-bold uppercase tracking-widest flex-1">
                        Unsorted
                      </span>
                      <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded-full">
                        {history.filter((h) => !h.folder_id).length}
                      </span>
                    </button>

                    {folders.map((f) => {
                      const folderItemCount = history.filter(
                        (h) => h.folder_id === f.id,
                      ).length;
                      return (
                        <button
                          key={f.id}
                          onClick={() => setActiveFolder(f.id)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add("border-pink-500");
                          }}
                          onDragLeave={(e) =>
                            e.currentTarget.classList.remove("border-pink-500")
                          }
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove("border-pink-500");
                            const itemId = e.dataTransfer.getData("itemId");
                            if (itemId) handleDropIntoFolder(itemId, f.id);
                          }}
                          className={`group flex items-center justify-between p-4 rounded-2xl border transition-all text-left ${activeFolder === f.id ? "bg-white/10 border-white/20 text-white" : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"}`}
                        >
                          <div className="flex items-center gap-3 flex-1 overflow-hidden">
                            <Folder className="w-5 h-5 shrink-0" />
                            <span className="text-xs font-bold uppercase tracking-widest truncate">
                              {f.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] bg-black/40 px-2 py-0.5 rounded-full">
                              {folderItemCount}
                            </span>
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFolder(f.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-colors bg-white/5 rounded-full ml-1"
                            >
                              <X className="w-3 h-3" />
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    <button
                      onClick={() => {
                        const name = window.prompt("Enter new folder name:");
                        if (name && name.trim())
                          handleCreateFolder(name.trim());
                      }}
                      className="mt-4 flex items-center justify-center gap-2 p-4 rounded-2xl border border-dashed border-white/20 text-slate-400 hover:text-white hover:border-pink-500/50 hover:bg-pink-500/10 transition-all"
                    >
                      <FolderPlus className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">
                        New Folder
                      </span>
                    </button>
                  </div>

                  {/* Grid Content */}
                  <div className="flex-1 w-full">
                    {(() => {
                      const displayHistory = history.filter((h) =>
                        activeFolder === "all"
                          ? true
                          : activeFolder
                            ? h.folder_id === activeFolder
                            : !h.folder_id,
                      );
                      if (displayHistory.length === 0) {
                        return (
                          <div className="aspect-[21/9] bg-[#0A0A0A] border border-slate-800 border-dashed rounded-[3rem] flex flex-col items-center justify-center text-slate-700 p-12 text-center w-full">
                            <RotateCcw className="w-12 h-12 mb-6 opacity-10" />
                            <p className="text-base font-bold tracking-[0.3em] opacity-20 uppercase">
                              Folder Empty
                            </p>
                            <p className="text-xs mt-3 italic opacity-20">
                              Drag clips here to organize or begin production
                            </p>
                          </div>
                        );
                      }
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                          {displayHistory.map((item) => (
                            <div
                              key={item.id}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  "itemId",
                                  item.id.toString(),
                                );
                                e.currentTarget.classList.add(
                                  "opacity-50",
                                  "scale-95",
                                );
                              }}
                              onDragEnd={(e) => {
                                e.currentTarget.classList.remove(
                                  "opacity-50",
                                  "scale-95",
                                );
                              }}
                              className="group bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col cursor-grab active:cursor-grabbing transition-transform"
                            >
                              <div className="aspect-video relative overflow-hidden">
                                {item.type === "video" || item.type === "studio_video" ? (
                                  <VideoPlayer
                                    src={item.url}
                                    className="w-full h-full"
                                  />
                                ) : (
                                  <img
                                    src={item.url}
                                    alt="History"
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1 rounded-full text-[9px] font-bold text-white uppercase tracking-widest">
                                  {item.type}
                                </div>
                              </div>
                              <div className="p-6 space-y-4 flex-1 flex flex-col">
                                <p className="text-xs text-slate-400 line-clamp-3 italic leading-relaxed flex-1">
                                  "{item.prompt}"
                                </p>
                                <div className="flex justify-between items-center pt-4 border-t border-slate-800/50">
                                  <span className="text-[10px] font-mono text-slate-600">
                                    {new Date(
                                      item.created_at,
                                    ).toLocaleDateString()}
                                  </span>
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        item.url,
                                        `gener8-archive-${item.id}`,
                                      )
                                    }
                                    className="text-slate-500 hover:text-white transition-colors"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </section>
            }
          />
        </Routes>
      </main>

      {/* Credit Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-3xl bg-black/90 animate-in fade-in duration-500">
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-12 rounded-[3rem] max-w-lg w-full text-center space-y-8 shadow-2xl ring-1 ring-white/5">
            <div className="w-24 h-24 l-gradient rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-pink-500/20">
              <Zap className="text-white w-12 h-12" />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-bold text-white tracking-tighter uppercase">
                Request Credits
              </h2>
              <p className="text-slate-400 text-base leading-relaxed px-6">
                Request additional production resources from the studio
                administrator.
              </p>
            </div>
            <div className="bg-black/40 p-8 rounded-[2rem] border border-white/10 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">
                  Amount Requested
                </label>
                <input
                  type="number"
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-center text-xl font-bold text-white"
                />
              </div>
              <button
                onClick={handleRequestCredits}
                className="w-full l-gradient text-white font-bold py-5 rounded-xl uppercase tracking-widest text-xs shadow-xl"
              >
                Send Request
              </button>
            </div>
            <button
              onClick={() => setShowRequestModal(false)}
              className="w-full py-5 text-xs font-bold text-slate-500 hover:text-white transition-all uppercase tracking-[0.4em] border border-white/10 rounded-2xl hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Credit Modal */}
      {showLimitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-3xl bg-black/90 animate-in fade-in duration-500">
          <div className="bg-white/5 backdrop-blur-3xl border border-white/10 p-12 rounded-[3rem] max-w-lg w-full text-center space-y-8 shadow-2xl ring-1 ring-white/5">
            <div className="w-24 h-24 l-gradient rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-pink-500/20">
              <Zap className="text-white w-12 h-12" />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-bold text-white tracking-tighter uppercase">
                Production Limit
              </h2>
              <p className="text-slate-400 text-base leading-relaxed px-6">
                Your studio account has reached its current production credit
                ceiling.
              </p>
            </div>
            <div className="bg-black/40 p-8 rounded-[2rem] border border-white/10 space-y-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em]">
                Request More
              </p>
              <p className="text-xs text-slate-400">
                You can request additional credits from the administrator.
              </p>
              <button
                onClick={() => {
                  setShowLimitModal(false);
                  setShowRequestModal(true);
                }}
                className="w-full l-gradient text-white font-bold py-4 rounded-xl mt-4 uppercase tracking-widest text-[10px]"
              >
                Request Credits
              </button>
            </div>
            <button
              onClick={() => setShowLimitModal(false)}
              className="w-full py-5 text-xs font-bold text-slate-500 hover:text-white transition-all uppercase tracking-[0.4em] border border-white/10 rounded-2xl hover:bg-white/5"
            >
              Close System Console
            </button>
          </div>
        </div>
      )}

      {/* Active Accounts Pop-out Menu */}
      {showUsersModal && (
        <div className="fixed inset-0 z-[100] flex justify-end animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUsersModal(false)}
          ></div>
          <div className="relative w-full max-w-md bg-black/60 backdrop-blur-2xl border-l border-white/10 h-full shadow-2xl flex flex-col animate-in slide-in-from-right-full duration-500">
            <div className="p-8 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight uppercase">
                  Active Accounts
                </h2>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                  {adminUsers.length} / 100 Provisioned
                </p>
              </div>
              <button
                onClick={() => setShowUsersModal(false)}
                className="p-2 hover:bg-white/5 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-4 hide-scrollbar">
              {adminUsers.map((u) => (
                <div
                  key={u.id}
                  className="p-5 bg-black/40 rounded-3xl border border-white/10 group hover:border-pink-500/20 transition-all"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                      <span className="text-xs font-bold text-slate-500">
                        {u.email[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[8px] font-black uppercase px-2 py-1 rounded ${u.role === "admin" ? "bg-pink-500/10 text-pink-500" : "bg-slate-800 text-slate-400"}`}
                      >
                        {u.role}
                      </span>
                      {u.id !== user?.id && (
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          className="p-1.5 bg-red-500/10 text-red-500 rounded hover:bg-red-500 hover:text-white transition-all"
                          title="Delete User"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-white mb-1 truncate">
                    {u.email}
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-pink-500 fill-pink-500" />
                      <span className="text-[10px] font-mono text-slate-400">
                        {u.credits}{" "}
                        <span className="text-[8px] opacity-50">
                          / {u.monthly_allowance}
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => alert("Not implemented")}
                        className="text-[9px] font-black text-slate-500 hover:text-white uppercase tracking-widest"
                      >
                        Reset Pwd
                      </button>
                      <button
                        onClick={() => handleUpdateCredits(u.id, u.credits)}
                        className="text-[9px] font-black text-slate-500 hover:text-pink-500 uppercase tracking-widest"
                      >
                        Edit Credits
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-8 border-t border-slate-800 bg-black/20">
              <button
                onClick={() => {
                  setShowUsersModal(false);
                  navigate("/admin");
                }}
                className="w-full py-4 text-[10px] font-bold text-slate-500 hover:text-white transition-all uppercase tracking-[0.3em] border border-white/10 rounded-xl hover:bg-white/5 flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Provision New Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Reset */}
      {selectedImage /* Image Lightbox Modal */ && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="relative bg-white/5 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 text-white hover:text-pink-500 z-10"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={selectedImage}
              alt="Generated"
              className="w-full h-auto object-contain rounded-t-2xl max-h-[70vh]"
              referrerPolicy="no-referrer"
            />
            <div className="p-6 flex justify-between items-center border-t border-slate-800">
              <div className="flex items-center gap-4">
                <button
                  onClick={() =>
                    handleDownload(selectedImage, "generated_image")
                  }
                  className="l-gradient text-white font-bold py-2 px-4 rounded-xl text-sm flex items-center gap-2 hover:scale-[1.02] transition-all"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
                <button
                  onClick={() => handleUpscaleImage(selectedImage, "2K")}
                  disabled={isUpscaling || isGenerating}
                  className="bg-pink-500/10 text-pink-500 font-bold py-2 px-4 rounded-xl text-sm flex items-center gap-2 hover:bg-pink-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpscaling ? (
                    "Upscaling..."
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" /> Upscale 2K (5 Credits)
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleUpscaleImage(selectedImage, "4K")}
                  disabled={isUpscaling || isGenerating}
                  className="bg-pink-500/10 text-pink-500 font-bold py-2 px-4 rounded-xl text-sm flex items-center gap-2 hover:bg-pink-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUpscaling ? (
                    "Upscaling..."
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" /> Upscale 4K (10 Credits)
                    </>
                  )}
                </button>
              </div>
              <button
                onClick={() => iterateOnImage(selectedImage)}
                className="text-slate-400 hover:text-white text-sm flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" /> Iterate
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-auto p-12 flex flex-col items-center gap-6 border-t border-slate-900 bg-[#0A0A0A]">
        <div className="text-[8px] font-bold text-slate-900 uppercase tracking-[0.4em]">
          AI Studio Standard • 16:9 • High-Fidelity
        </div>
      </footer>
    </div>
  );
};

export default App;
