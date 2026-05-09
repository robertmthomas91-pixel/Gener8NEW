import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import nodemailer from "nodemailer";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-for-dev";

// Email Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// In-memory Database with File Persistence
const DB_FILE = path.join(process.cwd(), 'database.json');

const loadDb = () => {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      return {
        users: new Map<string, any>(data.users || []),
        history: data.history || [],
        credit_requests: data.credit_requests || [],
        folders: data.folders || []
      };
    } catch (e) {
      console.error("Failed to load DB:", e);
    }
  }
  return {
    users: new Map<string, any>(),
    history: [] as any[],
    credit_requests: [] as any[],
    folders: [] as any[]
  };
};

const db = loadDb();

const saveDb = () => {
  try {
    const data = {
      users: Array.from(db.users.entries()),
      history: db.history,
      credit_requests: db.credit_requests,
      folders: db.folders
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Failed to save DB:", e);
  }
};

// Helper for monthly reset
const checkAndResetCredits = (user: any) => {
  if (!user) return null;
  
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
  
  if (user.last_reset_date !== currentMonth) {
    user.credits = user.monthly_allowance;
    user.last_reset_date = currentMonth;
    db.users.set(user.id, user);
    saveDb();
  }
  return user;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      let user = db.users.get(decoded.id);
      
      if (!user) {
        // Auto-recreate user if they have a valid JWT but aren't in the in-memory DB (e.g., after server restart)
        const now = new Date();
        user = {
          id: decoded.id,
          email: decoded.email,
          password: '', // We don't know their password, but they are already authenticated via JWT
          role: decoded.email === 'admin@gener8.ai' ? 'admin' : 'client',
          credits: 100,
          monthly_allowance: 100,
          created_at: now.toISOString(),
          last_reset_date: `${now.getFullYear()}-${now.getMonth() + 1}`
        };
        db.users.set(user.id, user);
        saveDb();
      }
      
      req.user = checkAndResetCredits(user);
      req.userId = user.id;
      next();
    } catch (err: any) {
      console.error("Auth error details:", err.message);
      res.status(401).json({ error: `Invalid token: ${err.message}` });
    }
  };

  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user.role === 'admin' || req.user.email === 'admin@gener8.ai') {
      next();
    } else {
      res.status(403).json({ error: "Forbidden: Admin access required" });
    }
  };

  // Public Auth Routes
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const normalizedEmail = email.toLowerCase();
    
    let user = Array.from(db.users.values()).find(u => u.email === normalizedEmail);
    
    if (!user) {
      // Auto-register if user doesn't exist (since in-memory DB wipes on restart)
      const hashedPassword = await bcrypt.hash(password, 10);
      const now = new Date();
      user = {
        id: Date.now().toString(),
        email: normalizedEmail,
        password: hashedPassword,
        role: normalizedEmail === 'admin@gener8.ai' ? 'admin' : 'client',
        credits: normalizedEmail === 'admin@gener8.ai' ? 1000 : 100,
        monthly_allowance: normalizedEmail === 'admin@gener8.ai' ? 1000 : 100,
        created_at: now.toISOString(),
        last_reset_date: `${now.getFullYear()}-${now.getMonth() + 1}`
      };
      db.users.set(user.id, user);
      saveDb();
    } else {
      // Self-heal role and credits if needed
      let needsSave = false;
      if (normalizedEmail === 'admin@gener8.ai') {
        if (user.role !== 'admin') {
          user.role = 'admin';
          needsSave = true;
        }
        if (user.monthly_allowance !== 1000) {
          user.monthly_allowance = 1000;
          user.credits = 1000;
          needsSave = true;
        }
      }
      if (needsSave) {
        db.users.set(user.id, user);
        saveDb();
      }

      if (user.password === '') {
        // Self-heal: User was auto-recreated from JWT without a password. Set it now.
        user.password = await bcrypt.hash(password, 10);
        db.users.set(user.id, user);
        saveDb();
      } else {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
      }
    }
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, credits: user.credits } });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const normalizedEmail = email.toLowerCase();
    
    if (Array.from(db.users.values()).some(u => u.email === normalizedEmail)) {
      return res.status(400).json({ error: "Email already exists" });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = new Date();
    const user = {
      id: Date.now().toString(),
      email: normalizedEmail,
      password: hashedPassword,
      role: normalizedEmail === 'admin@gener8.ai' ? 'admin' : 'client',
      credits: normalizedEmail === 'admin@gener8.ai' ? 1000 : 100,
      monthly_allowance: normalizedEmail === 'admin@gener8.ai' ? 1000 : 100,
      created_at: now.toISOString(),
      last_reset_date: `${now.getFullYear()}-${now.getMonth() + 1}`
    };
    
    db.users.set(user.id, user);
    saveDb();
    
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, credits: user.credits } });
  });

  // Admin Routes
  app.post("/api/admin/users", authenticate, isAdmin, async (req, res) => {
    const { email, password, role, monthly_allowance } = req.body;
    const normalizedEmail = email?.toLowerCase();
    try {
      if (db.users.size >= 100) {
        return res.status(400).json({ error: "Maximum studio capacity reached (100 users)." });
      }

      if (Array.from(db.users.values()).some(u => u.email === normalizedEmail)) {
        return res.status(400).json({ error: "A user with this email already exists." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
      
      const user = {
        id: Date.now().toString(),
        email: normalizedEmail,
        password: hashedPassword,
        role: role || 'client',
        credits: monthly_allowance || 100,
        monthly_allowance: monthly_allowance || 100,
        last_reset_date: currentMonth,
        created_at: new Date().toISOString()
      };
      
      db.users.set(user.id, user);
      saveDb();
      
      if (process.env.SMTP_HOST) {
        const loginUrl = process.env.APP_URL || `http://localhost:${PORT}`;
        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM || "gener8@gener8.ai",
            to: email,
            subject: "Welcome to Gener8 AI Studio",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h1 style="color: #E91E63;">Welcome to Gener8 AI Studio</h1>
                <p>Your studio account has been provisioned by the administrator.</p>
                <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
                  <p><strong>Login Email:</strong> ${email}</p>
                  <p><strong>Temporary Password:</strong> ${password}</p>
                </div>
                <p>You can access the platform and start producing cinematic assets here:</p>
                <a href="${loginUrl}" style="display: inline-block; background: #E91E63; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Enter Studio</a>
                <p style="margin-top: 30px; font-size: 12px; color: #888;">If you did not expect this email, please contact the studio administrator.</p>
              </div>
            `,
          });
        } catch (emailErr) {
          console.error("Failed to send welcome email:", emailErr);
          // Don't fail the user creation just because the email failed
        }
      }
      
      res.json({ status: "ok" });
    } catch (err: any) {
      console.error("User creation error:", err);
      res.status(400).json({ error: "Failed to create user. Please try again." });
    }
  });

  app.get("/api/admin/users", authenticate, isAdmin, async (req, res) => {
    const users = Array.from(db.users.values()).map(({ password, ...u }) => u);
    res.json(users);
  });

  app.delete("/api/admin/users/:id", authenticate, isAdmin, async (req: any, res) => {
    const { id } = req.params;
    if (id === req.userId) {
      return res.status(400).json({ error: "You cannot delete your own admin account." });
    }
    
    db.users.delete(id);
    db.history = db.history.filter(h => h.uid !== id);
    db.credit_requests = db.credit_requests.filter(r => r.uid !== id);
    saveDb();
    
    res.json({ status: "ok" });
  });

  app.post("/api/admin/users/:id/credits", authenticate, isAdmin, async (req, res) => {
    const { id } = req.params;
    const { credits } = req.body;
    const user = db.users.get(id);
    if (user) {
      user.credits = credits;
      db.users.set(id, user);
      saveDb();
    }
    res.json({ status: "ok" });
  });

  app.get("/api/admin/requests", authenticate, isAdmin, async (req, res) => {
    const requests = db.credit_requests
      .filter(r => r.status === 'pending')
      .map(r => {
        const user = db.users.get(r.uid);
        return { ...r, email: user?.email };
      });
    res.json(requests);
  });

  app.post("/api/admin/requests/approve", authenticate, isAdmin, async (req, res) => {
    const { requestId } = req.body;
    const request = db.credit_requests.find(r => r.id === requestId);
    
    if (request) {
      const user = db.users.get(request.uid);
      if (user) {
        user.credits += request.amount;
        db.users.set(user.id, user);
      }
      request.status = 'approved';
      saveDb();
    }
    res.json({ status: "ok" });
  });

  // Client Routes
  app.post("/api/credits/request", authenticate, async (req: any, res) => {
    const { amount } = req.body;
    db.credit_requests.push({
      id: Date.now().toString(),
      uid: req.userId,
      amount,
      status: 'pending',
      created_at: new Date().toISOString()
    });
    saveDb();
    res.json({ status: "ok" });
  });

  app.get("/api/credits", authenticate, (req: any, res) => {
    res.json({ credits: req.user.credits });
  });

  app.post("/api/credits", authenticate, async (req: any, res) => {
    const { amount } = req.body;
    const user = db.users.get(req.userId);
    if (user) {
      user.credits += amount;
      db.users.set(user.id, user);
      saveDb();
      res.json({ credits: user.credits });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.get("/api/history", authenticate, async (req: any, res) => {
    const rows = db.history
      .filter(h => h.uid === req.userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(rows);
  });

  app.put("/api/history/:id", authenticate, async (req: any, res) => {
    const { id } = req.params;
    const { folder_id } = req.body;
    const index = db.history.findIndex(h => h.id === id && h.uid === req.userId);
    if (index !== -1) {
      db.history[index].folder_id = folder_id;
      saveDb();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Item not found" });
    }
  });

  app.get("/api/folders", authenticate, async (req: any, res) => {
    const rows = db.folders.filter(f => f.uid === req.userId);
    res.json(rows);
  });

  app.post("/api/folders", authenticate, async (req: any, res) => {
    const { name } = req.body;
    const id = Date.now().toString();
    const newFolder = { id, uid: req.userId, name, created_at: new Date().toISOString() };
    db.folders.push(newFolder);
    saveDb();
    res.json(newFolder);
  });

  app.delete("/api/folders/:id", authenticate, async (req: any, res) => {
    const { id } = req.params;
    db.folders = db.folders.filter(f => !(f.id === id && f.uid === req.userId));
    db.history.forEach(h => {
      if (h.folder_id === id && h.uid === req.userId) h.folder_id = null;
    });
    saveDb();
    res.json({ success: true });
  });

  app.post("/api/history", authenticate, async (req: any, res) => {
    const { type, url, prompt } = req.body;
    const id = Date.now().toString();
    db.history.push({
      id,
      uid: req.userId,
      type,
      url,
      prompt,
      created_at: new Date().toISOString()
    });
    saveDb();
    res.json({ id });
  });

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));

  app.post("/api/upload", (req: any, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "No image provided" });
    
    try {
      const filename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      const filepath = path.join(uploadsDir, filename);
      
      // Remove data:image/png;base64, if present
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      
      fs.writeFileSync(filepath, buffer);
      
      res.json({ url: `/uploads/${filename}` });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to save image" });
    }
  });


  // Stripe Integration
  app.post("/api/subscribe", authenticate, async (req: any, res) => {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
    
    const user = db.users.get(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    
    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Gener8 Pro Subscription', description: 'Unlimited high-fidelity cinematic production' },
            unit_amount: 4900, // $49.00
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.headers.origin}/?success=true`,
        cancel_url: `${req.headers.origin}/?canceled=true`,
        customer_email: user.email,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook or simple success callback (for demo purposes, we'll use a direct update)
  app.post("/api/subscribe/confirm", authenticate, async (req: any, res) => {
    const user = db.users.get(req.userId);
    if (user) {
      user.credits += 5000;
      db.users.set(user.id, user);
      saveDb();
    }
    res.json({ status: "ok" });
  });

  app.post("/api/reset", authenticate, async (req: any, res) => {
    const user = db.users.get(req.userId);
    if (user) {
      user.credits = 100;
      user.monthly_allowance = 100;
      db.users.set(user.id, user);
    }
    
    db.history = db.history.filter(h => h.uid !== req.userId);
    saveDb();
    
    res.json({ status: "ok" });
  });

  app.post("/api/admin/reset-password", authenticate, isAdmin, async (req, res) => {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res.status(400).json({ error: "Email and new password are required" });
    }
    const normalizedEmail = email.toLowerCase();
    
    const user = Array.from(db.users.values()).find(u => u.email === normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    try {
      user.password = await bcrypt.hash(newPassword, 10);
      db.users.set(user.id, user);
      saveDb();
      res.json({ status: "ok" });
    } catch (err) {
      console.error("Password reset error:", err);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  app.post("/api/ai/generate", async (req, res) => {
    const { model, contents, config, type } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || (process.env as any).API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API Key not configured on server" });
    }

    console.log("Using API key starting with: " + apiKey.substring(0, 5) + " length: " + apiKey.length);

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      if (type === "video" || model.includes("veo")) {
        const response = await (ai as any).models.generateVideos({
          model,
          prompt: contents,
          config
        });
        return res.json(response);
      }

      if (type === "operation") {
        const response = await (ai as any).operations.getVideosOperation({
          operation: contents
        });
        return res.json(response);
      }

      // Default: generateContent
      const response = await ai.models.generateContent({
        model,
        contents: typeof contents === 'string' ? [{ role: 'user', parts: [{ text: contents }] }] : contents,
        config
      });
      res.json(response);
    } catch (error: any) {
      console.error("Gemini Proxy Error:", error);
      res.status(500).json({ error: error.message || "AI Generation failed" });
    }
  });

  app.get("/api/ai/video-proxy", async (req, res) => {
    const { url } = req.query;
    const apiKey = process.env.GEMINI_API_KEY || (process.env as any).API_KEY;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "Missing video URL" });
    }

    try {
      const response = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey || '' }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.statusText}`);
      }

      // Set appropriate headers
      res.setHeader('Content-Type', response.headers.get('Content-Type') || 'video/mp4');
      
      // Stream the response
      const body = response.body;
      if (body) {
        const reader = body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (error: any) {
      console.error("Video Proxy Error:", error);
      res.status(500).json({ error: "Failed to proxy video" });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({ 
      STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || ""
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Gener8 AI Studio Server running on http://0.0.0.0:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
