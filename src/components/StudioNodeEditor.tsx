import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Handle,
  Position,
  Node,
  Edge,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { v4 as uuidv4 } from "uuid";
import {
  Image as ImageIcon,
  Video,
  Sparkles,
  Plus,
  Upload,
  Trash,
  RefreshCcw,
  Download,
  Maximize,
  Type,
  Layers,
  User,
  Film,
  Eraser
} from "lucide-react";
import { auth, db, storage } from "../firebase";
import { doc, getDoc, updateDoc, increment, collection, addDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAppStore } from "../store/useAppStore";

const IMAGE_GEN_COST = 2;
const VIDEO_COST = 25;

const PROMPT_COLOR = "#c084fc"; // fuchsia-400
const FILE_COLOR = "#34d399";  // emerald-400
const RESULT_COLOR = "#60a5fa"; // blue-400

async function chargeCreditsSafely(amount: number) {
  if (!auth.currentUser) return false;
  const userRef = doc(db, "users", auth.currentUser.uid);
  const userDoc = await getDoc(userRef);
  if (userDoc.exists()) {
    const credits = userDoc.data().credits || 0;
    if (credits < amount) return false;
    await updateDoc(userRef, { credits: increment(-amount) });
    return true;
  }
  return false;
}

async function saveHistorySafely(type: string, dataUrlOrBlobUrl: string, prompt: string) {
  if (!auth.currentUser) return;
  try {
    let finalUrl = dataUrlOrBlobUrl;
    if (dataUrlOrBlobUrl.startsWith("blob:")) {
      const fetchRes = await fetch(dataUrlOrBlobUrl);
      const blob = await fetchRes.blob();
      const ext = blob.type.split("/")[1] || "bin";
      const storageRef = ref(storage, `history/${auth.currentUser.uid}/${Date.now()}.${ext}`);
      await uploadBytes(storageRef, blob as Blob);
      finalUrl = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, "history"), {
      user_id: auth.currentUser.uid,
      type,
      url: finalUrl,
      prompt,
      created_at: Date.now()
    });
  } catch (e) {
    console.warn("Failed to save history", e);
  }
}

async function callGeminiRaw(model: string, contents: any, config?: any, type?: "video" | "operation") {
  if (!auth.currentUser) throw new Error("Must be logged in.");
  const token = localStorage.getItem("token"); // or proper auth token
  const headers: any = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const reqBody = { model, contents, config, type };
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const port = window.location.port !== "3000" && window.location.hostname === "localhost" ? "3000" : window.location.port;
  const host = window.location.hostname;
  const url = port ? `${protocol}//${host}:${port}/api/gemini` : `/api/gemini`;

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(reqBody) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt);
  }
  return await res.json();
}

const upscaleCanvas = (src: string): Promise<string> => {
   return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
         const canvas = document.createElement("canvas");
         canvas.width = img.width * 2;
         canvas.height = img.height * 2;
         const ctx = canvas.getContext("2d");
         if (!ctx) return reject(new Error("No ctx"));
         ctx.imageSmoothingEnabled = false;
         ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
         resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Image failed to load"));
      img.src = src;
   });
};

/* ---------------- COMPONENTS ---------------- */

const NodeHeader = ({ title, onMenuClick, icon: Icon }: any) => (
  <div className="bg-[#2a2a2a] rounded-t-[16px] px-4 py-2 border-b border-[#3e3e3e] flex items-center justify-between">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-4 h-4 text-gray-400" />}
      <span className="text-xs font-bold text-gray-300 tracking-wide">{title}</span>
    </div>
    <button onClick={onMenuClick} className="text-gray-500 hover:text-red-400 transition-colors">
      <Trash className="w-3.5 h-3.5" />
    </button>
  </div>
);

const StyledHandle = (props: any) => (
  <Handle 
    {...props} 
    className="w-3 h-3 bg-[#1e1e1e] border-2 border-[var(--handle-color)] rounded-full transition-transform hover:scale-125"
    style={{ ...props.style, '--handle-color': props.color } as any}
  />
);

/* ---------------- PROMPT NODE ---------------- */
const PromptNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, setNodes } = useReactFlow();
  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-72 shadow-xl overflow-visible text-white font-sans">
      <NodeHeader title="Prompt" onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} icon={Type} />
      <div className="p-4">
        <textarea
          className="w-full bg-[#2a2a2a] border-0 rounded-lg p-3 text-sm text-gray-200 focus:ring-1 focus:ring-fuchsia-500/50 resize-none min-h-[100px] outline-none"
          placeholder="A cinematic shot of..."
          value={(data.prompt as string) || ""}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
        />
      </div>
      <StyledHandle type="source" position={Position.Right} id="prompt-out" color={PROMPT_COLOR} isConnectable={isConnectable} style={{ top: '50%', right: -6, transform: 'translateY(-50%)' }} />
    </div>
  );
};

/* ---------------- FILE REFERENCE NODE ---------------- */
const ImageRefNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, setNodes } = useReactFlow();
  const images = (data.images as string[]) || [];

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          updateNodeData(id, { images: [...(images), e.target.result as string] });
        }
      };
      reader.readAsDataURL(file as Blob);
    });
  };

  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-48 shadow-xl overflow-visible text-white font-sans">
      <NodeHeader title="File Reference" onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} icon={ImageIcon} />
      <div className="p-4 flex flex-col items-center justify-center gap-3">
        {images.map((img, i) => (
           <div key={i} className="relative w-full aspect-square rounded-lg overflow-hidden group">
             <img src={img} className="w-full h-full object-cover border border-white/10" alt="ref" />
             <button onClick={() => updateNodeData(id, { images: images.filter((_, idx) => idx !== i) })} className="absolute top-1 right-1 bg-black/60 p-1 rounded hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash className="w-3 h-3" />
             </button>
           </div>
        ))}
        <label className="w-full aspect-square cursor-pointer rounded-xl border-2 border-dashed border-emerald-500/30 flex flex-col items-center justify-center bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors">
          <Upload className="w-6 h-6 text-emerald-400 mb-2" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Upload Image</span>
          <input type="file" className="hidden" accept="image/*" multiple onChange={handleUpload} />
        </label>
      </div>
      <StyledHandle type="source" position={Position.Right} id="file-out" color={FILE_COLOR} isConnectable={isConnectable} style={{ top: '50%', right: -6, transform: 'translateY(-50%)' }} />
    </div>
  );
};

/* ---------------- GENERATOR EXECUTION HELPERS ---------------- */

const getIncomingData = (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[]) => {
  const edges = getEdges();
  const nodes = getNodes();
  
  const incoming = edges.filter(e => e.target === nodeId);
  let prompt = "";
  const refsByHandle: Record<string, string[]> = {};
  const allRefs: string[] = [];

  incoming.forEach(conn => {
     const n = nodes.find(x => x.id === conn.source);
     if (!n) return;
     let extractedRefs: string[] = [];
     if (n.type === 'promptNode' && n.data.prompt) prompt = n.data.prompt as string;
     if (n.type === 'imageRefNode' && n.data.images) extractedRefs = n.data.images as string[];
     if (n.data.resultUrl) extractedRefs.push(n.data.resultUrl as string);

     const handleName = conn.targetHandle || "default";
     if (!refsByHandle[handleName]) refsByHandle[handleName] = [];
     refsByHandle[handleName].push(...extractedRefs);
     allRefs.push(...extractedRefs);
  });

  return { prompt, refsByHandle, allRefs };
};

const convertToParts = (imageRefs: string[], promptText: string) => {
  const parts: any[] = [];
  for (const ref of imageRefs) {
    const match = ref.match(/^data:(.*?);base64,(.*)$/);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    } else {
      // In a real app we'd fetch url and convert to base64, leaving out for simplicity if it's already an external URL
    }
  }
  if (promptText) parts.push({ text: promptText });
  return parts;
};

const executeGenNode = async (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[], updateNodeData: any) => {
  const data = getIncomingData(nodeId, getNodes, getEdges);
  let finalPrompt = data.prompt || "A cinematic scene";
  updateNodeData(nodeId, { isGenerating: true });
  
  try {
    const hasCredits = await chargeCreditsSafely(IMAGE_GEN_COST);
    if (!hasCredits) throw new Error("Insufficient credits");

    const currentNode = getNodes().find(x => x.id === nodeId);
    const targetAspectRatio = currentNode?.data?.aspectRatio || "16:9";
    const parts = convertToParts(data.allRefs, finalPrompt);

    const response = await callGeminiRaw("gemini-3.1-flash-image-preview", { parts }, {
      imageConfig: { aspectRatio: targetAspectRatio }
    });
    
    const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (imagePart?.inlineData) {
       const base64Data = `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
       updateNodeData(nodeId, { resultUrl: base64Data });
       saveHistorySafely("image", base64Data, finalPrompt);
    } else {
      throw new Error("No image data returned from API");
    }
  } catch (e: any) {
    alert("Error: " + e.message);
  } finally {
    updateNodeData(nodeId, { isGenerating: false });
  }
};

const executeMultiAngleGenNode = async (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[], updateNodeData: any) => {
  const data = getIncomingData(nodeId, getNodes, getEdges);
  let basePrompt = data.prompt || "A high quality asset";
  updateNodeData(nodeId, { isGenerating: true, resultUrls: null });
  
  try {
    const totalCost = IMAGE_GEN_COST * 4;
    const hasCredits = await chargeCreditsSafely(totalCost);
    if (!hasCredits) throw new Error(`Insufficient credits (${totalCost} required)`);

    const currentNode = getNodes().find(x => x.id === nodeId);
    const targetAspectRatio = currentNode?.data?.aspectRatio || "16:9";
    
    const angles = ["Front View", "Side View", "Back View", "Top View"];
    const promises = angles.map(async (angle) => {
      const parts = convertToParts(data.allRefs, `${basePrompt}. ${angle}, clean background.`);
      const response = await callGeminiRaw("gemini-3.1-flash-image-preview", { parts }, {
        imageConfig: { aspectRatio: targetAspectRatio }
      });
      const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (imagePart?.inlineData) {
         return `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
      }
      return null;
    });

    const results = (await Promise.all(promises)).filter(Boolean) as string[];
    updateNodeData(nodeId, { resultUrls: results });
    results.forEach(r => saveHistorySafely("image", r, basePrompt + " (Multi-Angle)"));

  } catch (e: any) {
    alert("Error: " + e.message);
  } finally {
    updateNodeData(nodeId, { isGenerating: false });
  }
};

const executeAvatarGenNode = async (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[], updateNodeData: any) => {
  const data = getIncomingData(nodeId, getNodes, getEdges);
  let prompt = data.prompt || "A character standing";
  updateNodeData(nodeId, { isGenerating: true });
  
  try {
    const hasCredits = await chargeCreditsSafely(IMAGE_GEN_COST);
    if (!hasCredits) throw new Error("Insufficient credits");

    const charRefs = data.refsByHandle["char-in"] || [];
    const bgRefs = data.refsByHandle["bg-in"] || [];

    const charParts = convertToParts(charRefs, "");
    const bgParts = convertToParts(bgRefs, "");

    const finalPrompt = `GENERATE 16:9 1K CINEMATIC ASSET. 
BACKGROUND: Consistent with reference. 
AVATAR: ${prompt}. 
POSITIONING: The avatar MUST be in a MEDIUM SHOT (waist up), positioned in the RIGHT THIRD of the frame, looking towards the left. 
Format: 16:9 Landscape. Output: PNG.`;

    const parts = [{ text: finalPrompt }, ...bgParts, ...charParts];

    const response = await callGeminiRaw("gemini-2.5-flash-image", { parts }, {
      imageConfig: { aspectRatio: "16:9" }
    });
    
    const imagePart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (imagePart?.inlineData) {
       const base64Data = `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`;
       updateNodeData(nodeId, { resultUrl: base64Data });
       saveHistorySafely("image", base64Data, prompt + " (Avatar)");
    } else {
      throw new Error("No image data returned from API");
    }
  } catch (e: any) {
    alert("Error: " + e.message);
  } finally {
    updateNodeData(nodeId, { isGenerating: false });
  }
};

const executeVideoIngredientsNode = async (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[], updateNodeData: any) => {
  const data = getIncomingData(nodeId, getNodes, getEdges);
  let motionPrompt = data.prompt || "cinematic motion";
  updateNodeData(nodeId, { isGenerating: true });
  
  try {
    const hasCredits = await chargeCreditsSafely(VIDEO_COST);
    if (!hasCredits) throw new Error("Insufficient credits for Video");

    const allRefs = [...(data.refsByHandle["char-in"]||[]), ...(data.refsByHandle["style-in"]||[]), ...(data.refsByHandle["setting-in"]||[])];
    
    const referenceImagesPayload: any[] = [];
    for (const ref of allRefs) {
      const match = ref.match(/^data:(.*?);base64,(.*)$/);
      if (match) {
        referenceImagesPayload.push({
          image: { mimeType: match[1], imageBytes: match[2] },
          referenceType: "ASSET"
        });
      }
    }

    let operation = await callGeminiRaw("veo-3.1-lite-generate-preview", motionPrompt, {
        numberOfVideos: 1,
        referenceImages: referenceImagesPayload.length > 0 ? referenceImagesPayload : undefined,
        resolution: "720p",
        aspectRatio: "16:9",
      }, "video");

    let currentOp = operation;
    while (!currentOp.done) {
        await new Promise(r => setTimeout(r, 5000));
        currentOp = await callGeminiRaw("", currentOp, null, "operation");
    }
    
    const videoUrl = currentOp.response?.videos?.[0]?.uri;
    if (videoUrl) {
        updateNodeData(nodeId, { resultUrl: videoUrl });
        saveHistorySafely("video", videoUrl, motionPrompt);
    } else {
        throw new Error("Video generation failed on backend.");
    }
  } catch (e: any) {
    alert("Error: " + e.message);
  } finally {
    updateNodeData(nodeId, { isGenerating: false });
  }
};

const executeVideoFrameNode = async (nodeId: string, getNodes: () => Node[], getEdges: () => Edge[], updateNodeData: any) => {
  const data = getIncomingData(nodeId, getNodes, getEdges);
  let motionPrompt = data.prompt || "cinematic motion";
  updateNodeData(nodeId, { isGenerating: true });
  
  try {
    const hasCredits = await chargeCreditsSafely(VIDEO_COST);
    if (!hasCredits) throw new Error("Insufficient credits for Video");

    const startRefs = data.refsByHandle["start-in"] || [];
    const endRefs = data.refsByHandle["end-in"] || [];

    const getImgPayload = (refs: string[]) => {
      if (!refs[0]) return undefined;
      const match = refs[0].match(/^data:(.*?);base64,(.*)$/);
      if (match) return { mimeType: match[1], imageBytes: match[2] };
      return undefined;
    };

    let operation = await callGeminiRaw("veo-3.1-lite-generate-preview", motionPrompt, {
        numberOfVideos: 1,
        resolution: "720p",
        aspectRatio: "16:9",
        image: getImgPayload(startRefs),
        lastFrame: getImgPayload(endRefs)
      }, "video");

    let currentOp = operation;
    while (!currentOp.done) {
        await new Promise(r => setTimeout(r, 5000));
        currentOp = await callGeminiRaw("", currentOp, null, "operation");
    }
    
    const videoUrl = currentOp.response?.videos?.[0]?.uri;
    if (videoUrl) {
        updateNodeData(nodeId, { resultUrl: videoUrl });
        saveHistorySafely("video", videoUrl, motionPrompt);
    } else {
        throw new Error("Video generation failed on backend.");
    }
  } catch (e: any) {
    alert("Error: " + e.message);
  } finally {
    updateNodeData(nodeId, { isGenerating: false });
  }
};


/* ---------------- IMAGE SINGLE GEN NODE ---------------- */
const ImageStandardNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, getNodes, getEdges, setNodes } = useReactFlow();
  const imageInputs = Number(data.imageInputsCount) || 1;
  const maxProps = 5;

  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-80 shadow-2xl overflow-visible text-white font-sans relative">
      <NodeHeader title="Image Gen (Standard)" icon={ImageIcon} onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} />
      <div className="p-4 space-y-4">
        <div className="space-y-3 pt-2">
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="prompt-in" position={Position.Left} color={PROMPT_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#c084fc] font-medium pl-2">Prompt</span>
            </div>
            {Array.from({ length: imageInputs }).map((_, i) => (
               <div key={i} className="relative flex items-center h-8">
                 <StyledHandle type="target" id={`image-in-${i}`} position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
                 <span className="text-[10px] text-[#34d399] font-medium pl-2">Image {i + 1}</span>
                 {i > 0 && i === imageInputs - 1 && (
                     <button onClick={() => updateNodeData(id, { imageInputsCount: imageInputs - 1 })} className="ml-2 text-xs text-gray-500 hover:text-red-400"><Trash className="w-3 h-3" /></button>
                 )}
               </div>
            ))}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 flex gap-2 flex-col">
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Aspect Ratio</span>
          <div className="flex bg-black/40 rounded-lg p-1">
            {['1:1', '16:9', '9:16', '4:3', '3:4'].map(ratio => (
                <button
                  key={ratio}
                  onClick={() => updateNodeData(id, { aspectRatio: ratio })}
                  className={`flex-1 text-[10px] py-1 rounded-md transition-colors ${ (data.aspectRatio || '16:9') === ratio ? 'bg-white/10 text-white font-medium' : 'text-gray-500 hover:text-gray-300' }`}
                >
                  {ratio}
                </button>
            ))}
          </div>
        </div>
        {data.resultUrl && (
          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-black/40 group relative">
            <img src={data.resultUrl as string} className="w-full h-auto max-h-[200px] object-contain" />
          </div>
        )}
        <div className="flex items-center justify-between mt-4">
           {imageInputs < maxProps ? (
             <button onClick={() => updateNodeData(id, { imageInputsCount: imageInputs + 1 })} className="text-[10px] text-gray-400 hover:text-white transition-colors">
               + Add image input
             </button>
           ) : <div />}
           <button onClick={() => executeGenNode(id, getNodes, getEdges, updateNodeData)} disabled={!!data.isGenerating} className="bg-[#2a2a2a] hover:bg-[#333] border border-[#3e3e3e] text-[10px] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50">
             {data.isGenerating ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "→"} {data.isGenerating ? "Running..." : "Run"}
           </button>
        </div>
      </div>
      <StyledHandle type="source" position={Position.Right} id="result-out" color={RESULT_COLOR} isConnectable={isConnectable} style={{ top: 22, right: -6 }} />
    </div>
  );
};

/* ---------------- IMAGE MULTI ANGLE NODE ---------------- */
const ImageMultiAngleNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, getNodes, getEdges, setNodes } = useReactFlow();
  
  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-[360px] shadow-2xl overflow-visible text-white font-sans relative">
      <NodeHeader title="Multi Angle Gen" icon={Layers} onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} />
      <div className="p-4 space-y-4">
        <div className="space-y-3 pt-2">
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="prompt-in" position={Position.Left} color={PROMPT_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#c084fc] font-medium pl-2">Prompt</span>
            </div>
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="image-in" position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#34d399] font-medium pl-2">Reference Image(s)</span>
            </div>
        </div>
        
        {data.resultUrls && (data.resultUrls as string[]).length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl overflow-hidden border border-white/10 p-2 bg-black/40">
            {(data.resultUrls as string[]).map((url, idx) => (
               <img key={idx} src={url} className="w-full h-auto object-cover rounded-md aspect-square" />
            ))}
          </div>
        )}
        <div className="flex items-center justify-end mt-4">
           <button onClick={() => executeMultiAngleGenNode(id, getNodes, getEdges, updateNodeData)} disabled={!!data.isGenerating} className="bg-[#2a2a2a] hover:bg-[#333] border border-[#3e3e3e] text-[10px] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50">
             {data.isGenerating ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "→"} {data.isGenerating ? "Running (4x Cost)..." : "Generate 4 Angles"}
           </button>
        </div>
      </div>
      <StyledHandle type="source" position={Position.Right} id="result-out" color={RESULT_COLOR} isConnectable={isConnectable} style={{ top: 22, right: -6 }} />
    </div>
  );
};

/* ---------------- IMAGE AVATAR NODE ---------------- */
const ImageAvatarNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, getNodes, getEdges, setNodes } = useReactFlow();
  
  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-[320px] shadow-2xl overflow-visible text-white font-sans relative">
      <NodeHeader title="Avatar Generator" icon={User} onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} />
      <div className="p-4 space-y-4">
        <div className="space-y-3 pt-2">
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="prompt-in" position={Position.Left} color={PROMPT_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#c084fc] font-medium pl-2">Prompt (Description)</span>
            </div>
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="char-in" position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#34d399] font-medium pl-2">Character Ref</span>
            </div>
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="bg-in" position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#34d399] font-medium pl-2">Background Ref</span>
            </div>
        </div>
        
        {data.resultUrl && (
          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-black/40 group relative">
            <img src={data.resultUrl as string} className="w-full h-auto object-contain aspect-video" />
          </div>
        )}
        <div className="flex items-center justify-end mt-4">
           <button onClick={() => executeAvatarGenNode(id, getNodes, getEdges, updateNodeData)} disabled={!!data.isGenerating} className="bg-[#2a2a2a] hover:bg-[#333] border border-[#3e3e3e] text-[10px] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50">
             {data.isGenerating ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "→"} {data.isGenerating ? "Generating..." : "Generate Avatar"}
           </button>
        </div>
      </div>
      <StyledHandle type="source" position={Position.Right} id="result-out" color={RESULT_COLOR} isConnectable={isConnectable} style={{ top: 22, right: -6 }} />
    </div>
  );
};

/* ---------------- VIDEO INGREDIENTS NODE ---------------- */
const VideoIngredientsNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, getNodes, getEdges, setNodes } = useReactFlow();
  
  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-[320px] shadow-2xl overflow-visible text-white font-sans relative">
      <NodeHeader title="Video (Ingredients)" icon={Sparkles} onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} />
      <div className="p-4 space-y-4">
        <div className="space-y-3 pt-2">
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="prompt-in" position={Position.Left} color={PROMPT_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#c084fc] font-medium pl-2">Motion Prompt</span>
            </div>
            {["character", "style", "setting"].map(k => (
                <div key={k} className="relative flex items-center h-8">
                  <StyledHandle type="target" id={`${k}-in`} position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
                  <span className="text-[10px] text-[#34d399] font-medium pl-2 capitalize">{k}</span>
                </div>
            ))}
        </div>
        
        {data.resultUrl && (
          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-black/40 group relative">
            <video src={data.resultUrl as string} controls autoPlay loop className="w-full h-auto aspect-video object-contain" />
          </div>
        )}
        <div className="flex items-center justify-end mt-4">
           <button onClick={() => executeVideoIngredientsNode(id, getNodes, getEdges, updateNodeData)} disabled={!!data.isGenerating} className="bg-[#2a2a2a] hover:bg-[#333] border border-[#3e3e3e] text-[10px] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50">
             {data.isGenerating ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "→"} {data.isGenerating ? "Generating Video..." : "Generate Video"}
           </button>
        </div>
      </div>
      <StyledHandle type="source" position={Position.Right} id="result-out" color={RESULT_COLOR} isConnectable={isConnectable} style={{ top: 22, right: -6 }} />
    </div>
  );
};

/* ---------------- VIDEO FRAME TO FRAME NODE ---------------- */
const VideoFrameToFrameNode = ({ id, data, isConnectable }: NodeProps) => {
  const { updateNodeData, getNodes, getEdges, setNodes } = useReactFlow();
  
  return (
    <div className="bg-[#1e1e1e] border border-[#2e2e2e] rounded-[16px] w-[320px] shadow-2xl overflow-visible text-white font-sans relative">
      <NodeHeader title="Video (Frame to Frame)" icon={Film} onMenuClick={() => setNodes(nds => nds.filter(n => n.id !== id))} />
      <div className="p-4 space-y-4">
        <div className="space-y-3 pt-2">
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="prompt-in" position={Position.Left} color={PROMPT_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#c084fc] font-medium pl-2">Motion Prompt</span>
            </div>
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="start-in" position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#34d399] font-medium pl-2">Start Frame</span>
            </div>
            <div className="relative flex items-center h-8">
              <StyledHandle type="target" id="end-in" position={Position.Left} color={FILE_COLOR} style={{ top: '50%', left: -22, transform: 'translateY(-50%)' }} isConnectable={isConnectable} />
              <span className="text-[10px] text-[#34d399] font-medium pl-2">End Frame</span>
            </div>
        </div>
        
        {data.resultUrl && (
          <div className="mt-4 rounded-xl overflow-hidden border border-white/10 bg-black/40 group relative">
            <video src={data.resultUrl as string} controls autoPlay loop className="w-full h-auto aspect-video object-contain" />
          </div>
        )}
        <div className="flex items-center justify-end mt-4">
           <button onClick={() => executeVideoFrameNode(id, getNodes, getEdges, updateNodeData)} disabled={!!data.isGenerating} className="bg-[#2a2a2a] hover:bg-[#333] border border-[#3e3e3e] text-[10px] text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50">
             {data.isGenerating ? <RefreshCcw className="w-3 h-3 animate-spin" /> : "→"} {data.isGenerating ? "Interpolating Views..." : "Run Sequence"}
           </button>
        </div>
      </div>
      <StyledHandle type="source" position={Position.Right} id="result-out" color={RESULT_COLOR} isConnectable={isConnectable} style={{ top: 22, right: -6 }} />
    </div>
  );
};


/* ---------------- NODE EDITOR MAIN ENTRANCE ---------------- */

const nodeTypes = {
  promptNode: PromptNode,
  imageRefNode: ImageRefNode,
  imageStandardNode: ImageStandardNode,
  imageMultiAngleNode: ImageMultiAngleNode,
  imageAvatarNode: ImageAvatarNode,
  videoIngredientsNode: VideoIngredientsNode,
  videoFrameToFrameNode: VideoFrameToFrameNode,
};

function FlowCanvas() {
  const { studioNodes: nodes, studioEdges: edges, setStudioNodes: setNodes, setStudioEdges: setEdges } = useAppStore();

  const onNodesChange = useCallback((changes: any) => setNodes((nds: any) => applyNodeChanges(changes, nds)), [setNodes]);
  const onEdgesChange = useCallback((changes: any) => setEdges((eds: any) => applyEdgeChanges(changes, eds)), [setEdges]);
  const onConnect = useCallback((params: any) => setEdges((eds: any) => addEdge(params, eds)), [setEdges]);

  const addNode = useCallback((type: string) => {
    const newNodeId = uuidv4();
    const newNode: Node = {
      id: newNodeId,
      type,
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: {}
    };
    setNodes((nds: any[]) => [...nds, newNode]);
  }, [setNodes]);

  const clearNodes = useCallback(() => {
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  return (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#555" gap={24} size={1} variant={"dots" as any} className="opacity-60" />
        <Controls className="bg-[#1e1e1e] border border-white/10 fill-gray-400" />
        <Panel position="top-left" className="p-4 flex flex-wrap gap-2 max-w-full">
          <button onClick={() => addNode('promptNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-[#c084fc] flex items-center gap-2 transition-colors">
             <Type className="w-3 h-3" /> Prompt
          </button>
          <button onClick={() => addNode('imageRefNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-[#34d399] flex items-center gap-2 transition-colors">
             <Upload className="w-3 h-3" /> File
          </button>
          <div className="w-[1px] h-8 bg-white/10 mx-2" />
          <button onClick={() => addNode('imageStandardNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-white flex items-center gap-2 transition-colors">
             <ImageIcon className="w-3 h-3" /> Image (Standard)
          </button>
          <button onClick={() => addNode('imageMultiAngleNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-white flex items-center gap-2 transition-colors">
             <Layers className="w-3 h-3" /> Multi Angle
          </button>
          <button onClick={() => addNode('imageAvatarNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-white flex items-center gap-2 transition-colors">
             <User className="w-3 h-3" /> Avatar Gen
          </button>
          <div className="w-[1px] h-8 bg-white/10 mx-2" />
          <button onClick={() => addNode('videoIngredientsNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-[#fb923c] flex items-center gap-2 transition-colors">
             <Sparkles className="w-3 h-3" /> Ingredients
          </button>
          <button onClick={() => addNode('videoFrameToFrameNode')} className="bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-[#2e2e2e] px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-[#fb923c] flex items-center gap-2 transition-colors">
             <Film className="w-3 h-3" /> Frame to Frame
          </button>

          <div className="flex-1" />
          <button onClick={clearNodes} className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-4 py-2 rounded-lg text-xs font-bold tracking-wide text-red-400 flex items-center gap-2 transition-colors">
             <Eraser className="w-3 h-3" /> Clear Nodes
          </button>
        </Panel>
      </ReactFlow>
  );
}

export default function StudioNodeEditor() {
  return (
    <div className="w-full h-full flex relative bg-[#0e0e0e] rounded-3xl overflow-hidden shadow-2xl">
      <ReactFlowProvider>
        <FlowCanvas />
      </ReactFlowProvider>
    </div>
  );
}
