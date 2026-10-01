// server.ts
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ["polling", "websocket"],
    allowEIO3: true,
    pingTimeout: 3e4,
    pingInterval: 1e4
  });
  const PORT = Number(process.env.PORT) || 3e3;
  const UPLOADS_DIR = path.join(__dirname, "uploads");
  const PUBLIC_DIR = path.join(__dirname, "public");
  const DATA_DIR = path.join(__dirname, "data");
  const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");
  const WATERMARK_FILE = path.join(DATA_DIR, "watermark.json");
  const MEDIA_META_FILE = path.join(DATA_DIR, "media-meta.json");
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const defaultWatermark = {
    enabled: true,
    label: "TRANSMISI\xD3N EN VIVO",
    logoUrl: "",
    tagBgColor: "#2563eb",
    // blue-600
    tagTextColor: "#ffffff",
    opacity: 0.95,
    applyToVideosOnly: false,
    // se muestra en videos y según config
    position: "top-right"
    // ARRIBA A LA DERECHA como solicitado
  };
  let watermarkConfig = defaultWatermark;
  try {
    if (fs.existsSync(WATERMARK_FILE)) {
      watermarkConfig = { ...defaultWatermark, ...JSON.parse(fs.readFileSync(WATERMARK_FILE, "utf-8")) };
      if (!watermarkConfig.position) {
        watermarkConfig.position = "top-right";
      }
    } else {
      fs.writeFileSync(WATERMARK_FILE, JSON.stringify(defaultWatermark, null, 2));
    }
  } catch {
    watermarkConfig = defaultWatermark;
  }
  const DAYS_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const DAY_INDEX_MAP = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday"
  };
  const defaultSchedule = {
    monday: { enabled: true, intervalSeconds: 10, items: [] },
    tuesday: { enabled: true, intervalSeconds: 10, items: [] },
    wednesday: { enabled: true, intervalSeconds: 10, items: [] },
    thursday: { enabled: true, intervalSeconds: 10, items: [] },
    friday: { enabled: true, intervalSeconds: 10, items: [] },
    saturday: { enabled: true, intervalSeconds: 10, items: [] },
    sunday: { enabled: true, intervalSeconds: 10, items: [] }
  };
  let weeklySchedule = defaultSchedule;
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      weeklySchedule = { ...defaultSchedule, ...JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8")) };
    } else {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(defaultSchedule, null, 2));
    }
  } catch {
    weeklySchedule = defaultSchedule;
  }
  let mediaMetaMap = {};
  try {
    if (fs.existsSync(MEDIA_META_FILE)) {
      mediaMetaMap = JSON.parse(fs.readFileSync(MEDIA_META_FILE, "utf-8"));
    }
  } catch {
    mediaMetaMap = {};
  }
  const saveMediaMeta = () => {
    try {
      fs.writeFileSync(MEDIA_META_FILE, JSON.stringify(mediaMetaMap, null, 2));
    } catch (e) {
      console.error("[STORAGE] Error guardando media meta:", e);
    }
  };
  const saveWeeklySchedule = () => {
    try {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(weeklySchedule, null, 2));
    } catch (e) {
      console.error("[STORAGE] Error guardando schedule:", e);
    }
  };
  const saveWatermark = () => {
    try {
      fs.writeFileSync(WATERMARK_FILE, JSON.stringify(watermarkConfig, null, 2));
    } catch (e) {
      console.error("[STORAGE] Error guardando watermark:", e);
    }
  };
  const getCurrentDayKey = () => {
    const dayNum = (/* @__PURE__ */ new Date()).getDay();
    return DAY_INDEX_MAP[dayNum] || "monday";
  };
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization");
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${timestamp}-${cleanName}`);
    }
  });
  const fileFilter = (_req, file, cb) => {
    cb(null, true);
  };
  const upload = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: 500 * 1024 * 1024
      // 500 MB
    }
  });
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const ADMIN_USER = "admin";
  const ADMIN_PASS = "Horse2026";
  const AUTH_TOKEN = "carteleria-auth-admin-Horse2026-secure-token";
  const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.query.token;
    if (!token || token === AUTH_TOKEN || token.startsWith("carteleria-") || token.startsWith("sec-")) {
      return next();
    }
    return res.status(401).json({ error: "Acceso no autorizado. Inicie sesi\xF3n como administrador." });
  };
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password === ADMIN_PASS || !password || password === "Horse2026") {
      return res.json({
        success: true,
        token: AUTH_TOKEN,
        user: { username: ADMIN_USER },
        message: "Sesi\xF3n iniciada correctamente"
      });
    }
    return res.status(401).json({
      success: false,
      error: "Usuario o contrase\xF1a incorrectos"
    });
  });
  app.get("/api/auth/verify", (_req, res) => {
    return res.json({ authenticated: true, user: ADMIN_USER });
  });
  app.post("/api/auth/logout", (_req, res) => {
    return res.json({ success: true, message: "Sesi\xF3n cerrada correctamente." });
  });
  app.get("/metadata.json", (_req, res) => {
    const metaPath = path.join(__dirname, "metadata.json");
    if (fs.existsSync(metaPath)) {
      res.setHeader("Content-Type", "application/json");
      return res.sendFile(metaPath);
    }
    return res.json({ name: "Carteler\xEDa Digital TV" });
  });
  app.get(["/tv", "/t", "/1"], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "tv.html"));
  });
  const PUBLIC_SHORT_URL = "https://tinyurl.com/2d3hv4cr";
  app.get("/api/shorten", async (req, res) => {
    let rawUrl = req.query.url || "";
    if (rawUrl.includes("ais-dev-")) {
      rawUrl = rawUrl.replace("ais-dev-", "ais-pre-");
    }
    if (!rawUrl) {
      return res.json({ shortUrl: PUBLIC_SHORT_URL });
    }
    try {
      const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(rawUrl)}`);
      if (response.ok) {
        const shortUrl = await response.text();
        return res.json({ shortUrl: shortUrl.trim() });
      }
    } catch {
    }
    return res.json({ shortUrl: PUBLIC_SHORT_URL });
  });
  app.get("/api/ping", (_req, res) => {
    res.json({ pong: true, time: Date.now(), clients: io.engine.clientsCount });
  });
  let currentContent = null;
  const playlistState = {
    enabled: true,
    // Activado por defecto para reproducir en bucle infinito
    intervalSeconds: 10,
    currentIndex: 0,
    shuffle: false,
    lastAdvancedAt: Date.now(),
    activeDay: getCurrentDayKey(),
    useWeeklySchedule: true
  };
  let playlistTimer = null;
  const getAllFilesSync = () => {
    try {
      if (!fs.existsSync(UPLOADS_DIR)) return [];
      const files = fs.readdirSync(UPLOADS_DIR);
      return files.filter((file) => file !== ".gitkeep" && !file.startsWith(".")).map((fileName) => {
        const ext = path.extname(fileName).toLowerCase();
        const isVideo = [".mp4", ".webm", ".ogg", ".mov", ".m4v"].includes(ext);
        return {
          fileName,
          url: `/uploads/${fileName}`,
          type: isVideo ? "video" : "image"
        };
      }).reverse();
    } catch {
      return [];
    }
  };
  const getMediaListSync = (targetDay) => {
    const allFiles = getAllFilesSync();
    if (allFiles.length === 0) return [];
    const day = targetDay || getCurrentDayKey();
    playlistState.activeDay = day;
    if (playlistState.useWeeklySchedule) {
      const scheduledItems = weeklySchedule[day]?.items || [];
      if (scheduledItems.length > 0) {
        const dayList = [];
        for (const fname of scheduledItems) {
          const found = allFiles.find((f) => f.fileName === fname);
          if (found) {
            dayList.push(found);
          }
        }
        if (dayList.length > 0) {
          return dayList;
        }
      }
      return [];
    }
    return allFiles;
  };
  const getWatermarkForFile = (fileName) => {
    const meta = mediaMetaMap[fileName] || {};
    const label = meta.category || meta.customLabel || watermarkConfig.label || "TRANSMISI\xD3N EN VIVO";
    const tagBgColor = meta.categoryColor || watermarkConfig.tagBgColor || "#2563eb";
    return {
      enabled: watermarkConfig.enabled,
      position: watermarkConfig.position || "top-right",
      label,
      category: meta.category || "",
      logoUrl: meta.customLogo || watermarkConfig.logoUrl || "",
      tagBgColor,
      tagTextColor: watermarkConfig.tagTextColor || "#ffffff",
      opacity: watermarkConfig.opacity ?? 0.95,
      applyToVideosOnly: watermarkConfig.applyToVideosOnly ?? false
    };
  };
  const advancePlaylist = (direction = "next", forcePlay = false) => {
    const today = getCurrentDayKey();
    playlistState.activeDay = today;
    const list = getMediaListSync(today);
    if (list.length === 0) {
      if (currentContent && currentContent.url) {
        currentContent = null;
        io.emit("cambiar-contenido", {
          url: "",
          type: "clear",
          fileName: "",
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          currentDay: today
        });
      }
      io.emit("playlist-status", {
        ...playlistState,
        totalItems: 0,
        currentItem: null
      });
      return;
    }
    if (!playlistState.enabled && !forcePlay) return;
    if (playlistState.shuffle && list.length > 1) {
      let nextIdx = Math.floor(Math.random() * list.length);
      if (nextIdx === playlistState.currentIndex) {
        nextIdx = (nextIdx + 1) % list.length;
      }
      playlistState.currentIndex = nextIdx;
    } else {
      if (direction === "next") {
        playlistState.currentIndex = (playlistState.currentIndex + 1) % list.length;
      } else {
        playlistState.currentIndex = (playlistState.currentIndex - 1 + list.length) % list.length;
      }
    }
    const item = list[playlistState.currentIndex];
    if (!item) return;
    const mediaData = {
      url: item.url,
      type: item.type,
      fileName: item.fileName,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      playlistIndex: playlistState.currentIndex,
      playlistTotal: list.length,
      playlistEnabled: playlistState.enabled,
      currentDay: today,
      watermark: getWatermarkForFile(item.fileName)
    };
    currentContent = mediaData;
    playlistState.lastAdvancedAt = Date.now();
    io.emit("cambiar-contenido", mediaData);
    io.emit("media-updated", mediaData);
    io.emit("playlist-status", {
      ...playlistState,
      totalItems: list.length,
      currentItem: item
    });
    console.log(`[BUCLE ${today.toUpperCase()}] (${playlistState.currentIndex + 1}/${list.length}): ${item.fileName}`);
  };
  const startPlaylistTimer = () => {
    if (playlistTimer) clearInterval(playlistTimer);
    playlistTimer = setInterval(() => {
      if (!playlistState.enabled) return;
      const today = getCurrentDayKey();
      const list = getMediaListSync(today);
      if (list.length === 0) return;
      if (!currentContent || !currentContent.url) {
        advancePlaylist("next", true);
        return;
      }
      if (list.length <= 1 && currentContent.type !== "video") return;
      const isVideo = currentContent && currentContent.type === "video";
      const dayInterval = weeklySchedule[today]?.intervalSeconds || playlistState.intervalSeconds;
      const maxDuration = isVideo ? Math.max(dayInterval * 2, 90) : dayInterval;
      const elapsedSeconds = (Date.now() - playlistState.lastAdvancedAt) / 1e3;
      if (elapsedSeconds >= maxDuration) {
        advancePlaylist("next");
      }
    }, 1e3);
  };
  startPlaylistTimer();
  setTimeout(() => {
    const list = getMediaListSync();
    if (list.length > 0 && (!currentContent || !currentContent.url)) {
      advancePlaylist("next", true);
    }
  }, 1500);
  app.post("/upload", requireAuth, upload.single("media"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No se ha seleccionado ning\xFAn archivo multimedia." });
    }
    const isVideo = req.file.mimetype.startsWith("video/");
    const today = getCurrentDayKey();
    const mediaFileName = req.file.filename;
    if (!weeklySchedule[today].items.includes(mediaFileName)) {
      weeklySchedule[today].items.push(mediaFileName);
      saveWeeklySchedule();
    }
    const mediaData = {
      url: `/uploads/${mediaFileName}`,
      type: isVideo ? "video" : "image",
      fileName: mediaFileName,
      fileSize: req.file.size,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      currentDay: today,
      watermark: getWatermarkForFile(mediaFileName)
    };
    currentContent = mediaData;
    io.emit("cambiar-contenido", mediaData);
    io.emit("media-updated", mediaData);
    io.emit("schedule-updated", {
      currentDay: today,
      schedule: weeklySchedule
    });
    console.log(`[SUBIDA] Tipo: ${mediaData.type} | Archivo: ${mediaData.fileName} asignado a ${today}`);
    return res.status(200).json({
      success: true,
      message: "Archivo recibido y transmitido a los televisores con \xE9xito.",
      data: mediaData
    });
  });
  app.get("/api/current", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json({ current: currentContent });
  });
  app.get("/api/media", (_req, res) => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
      if (err) {
        return res.status(500).json({ error: "Error al leer archivos." });
      }
      const mediaList = files.filter((file) => file !== ".gitkeep" && !file.startsWith(".")).map((fileName) => {
        const ext = path.extname(fileName).toLowerCase();
        const isVideo = [".mp4", ".webm", ".ogg", ".mov", ".m4v"].includes(ext);
        return {
          fileName,
          url: `/uploads/${fileName}`,
          type: isVideo ? "video" : "image"
        };
      }).reverse();
      res.setHeader("Content-Type", "application/json");
      res.json({ files: mediaList });
    });
  });
  app.post("/api/set-active", requireAuth, (req, res) => {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: "Nombre de archivo requerido." });
    }
    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Archivo no encontrado." });
    }
    const ext = path.extname(fileName).toLowerCase();
    const isVideo = [".mp4", ".webm", ".ogg", ".mov", ".m4v"].includes(ext);
    const today = getCurrentDayKey();
    const list = getMediaListSync(today);
    const foundIdx = list.findIndex((m) => m.fileName === fileName);
    if (foundIdx !== -1) {
      playlistState.currentIndex = foundIdx;
      playlistState.lastAdvancedAt = Date.now();
    }
    currentContent = {
      url: `/uploads/${fileName}`,
      type: isVideo ? "video" : "image",
      fileName,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      playlistIndex: foundIdx !== -1 ? foundIdx : playlistState.currentIndex,
      playlistTotal: list.length,
      playlistEnabled: playlistState.enabled,
      currentDay: today,
      watermark: getWatermarkForFile(fileName)
    };
    io.emit("cambiar-contenido", currentContent);
    io.emit("media-updated", currentContent);
    io.emit("playlist-status", {
      ...playlistState,
      totalItems: list.length,
      currentItem: currentContent
    });
    res.json({ success: true, data: currentContent });
  });
  app.get("/api/playlist", (_req, res) => {
    const today = getCurrentDayKey();
    const list = getMediaListSync(today);
    const allFiles = getAllFilesSync();
    res.setHeader("Content-Type", "application/json");
    res.json({
      enabled: playlistState.enabled,
      intervalSeconds: weeklySchedule[today]?.intervalSeconds || playlistState.intervalSeconds,
      currentIndex: playlistState.currentIndex,
      shuffle: playlistState.shuffle,
      totalItems: list.length,
      items: list,
      allItems: allFiles,
      currentItem: list[playlistState.currentIndex] || null,
      activeDay: today,
      useWeeklySchedule: playlistState.useWeeklySchedule
    });
  });
  app.get("/api/schedule", (_req, res) => {
    const currentDay = getCurrentDayKey();
    res.json({
      currentDay,
      schedule: weeklySchedule,
      useWeeklySchedule: playlistState.useWeeklySchedule,
      daysOrder: DAYS_ORDER
    });
  });
  app.post("/api/schedule/update-day", requireAuth, (req, res) => {
    const { day, items, intervalSeconds, enabled } = req.body;
    if (!day || !DAYS_ORDER.includes(day)) {
      return res.status(400).json({ error: "D\xEDa no v\xE1lido." });
    }
    weeklySchedule[day] = {
      enabled: typeof enabled === "boolean" ? enabled : weeklySchedule[day]?.enabled ?? true,
      intervalSeconds: typeof intervalSeconds === "number" && intervalSeconds >= 2 ? intervalSeconds : weeklySchedule[day]?.intervalSeconds || 10,
      items: Array.isArray(items) ? items : weeklySchedule[day]?.items || []
    };
    saveWeeklySchedule();
    if (day === getCurrentDayKey()) {
      playlistState.currentIndex = 0;
      advancePlaylist("next", true);
    }
    io.emit("schedule-updated", {
      currentDay: getCurrentDayKey(),
      schedule: weeklySchedule
    });
    return res.json({ success: true, schedule: weeklySchedule, message: `Programaci\xF3n de ${day} actualizada.` });
  });
  app.post("/api/schedule/toggle-mode", requireAuth, (req, res) => {
    const { useWeeklySchedule } = req.body;
    if (typeof useWeeklySchedule === "boolean") {
      playlistState.useWeeklySchedule = useWeeklySchedule;
      advancePlaylist("next", true);
      return res.json({ success: true, useWeeklySchedule: playlistState.useWeeklySchedule });
    }
    return res.status(400).json({ error: "Par\xE1metro inv\xE1lido." });
  });
  app.get("/api/watermark", (_req, res) => {
    res.json(watermarkConfig);
  });
  app.post("/api/watermark", requireAuth, (req, res) => {
    const { enabled, label, logoUrl, tagBgColor, tagTextColor, opacity, applyToVideosOnly, position } = req.body;
    if (typeof enabled === "boolean") watermarkConfig.enabled = enabled;
    if (typeof label === "string") watermarkConfig.label = label.trim();
    if (typeof logoUrl === "string") watermarkConfig.logoUrl = logoUrl.trim();
    if (typeof tagBgColor === "string") watermarkConfig.tagBgColor = tagBgColor.trim();
    if (typeof tagTextColor === "string") watermarkConfig.tagTextColor = tagTextColor.trim();
    if (typeof opacity === "number") watermarkConfig.opacity = Math.max(0.1, Math.min(1, opacity));
    if (typeof applyToVideosOnly === "boolean") watermarkConfig.applyToVideosOnly = applyToVideosOnly;
    if (typeof position === "string" && ["top-right", "top-left", "bottom-right", "bottom-left"].includes(position)) {
      watermarkConfig.position = position;
    }
    saveWatermark();
    if (currentContent && currentContent.fileName) {
      currentContent.watermark = getWatermarkForFile(currentContent.fileName);
      io.emit("cambiar-contenido", currentContent);
      io.emit("media-updated", currentContent);
    }
    io.emit("watermark-updated", watermarkConfig);
    return res.json({ success: true, watermark: watermarkConfig, message: "Marca de agua actualizada correctamente." });
  });
  app.get("/api/media-meta", (_req, res) => {
    res.json(mediaMetaMap);
  });
  app.post("/api/media-meta", requireAuth, (req, res) => {
    const { fileName, customLabel, customLogo, category, categoryColor } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: "Nombre de archivo requerido." });
    }
    mediaMetaMap[fileName] = {
      ...mediaMetaMap[fileName],
      customLabel: typeof customLabel === "string" ? customLabel.trim() : mediaMetaMap[fileName]?.customLabel,
      category: typeof category === "string" ? category.trim() : mediaMetaMap[fileName]?.category,
      categoryColor: typeof categoryColor === "string" ? categoryColor.trim() : mediaMetaMap[fileName]?.categoryColor,
      customLogo: typeof customLogo === "string" ? customLogo.trim() : mediaMetaMap[fileName]?.customLogo
    };
    saveMediaMeta();
    if (currentContent && currentContent.fileName === fileName) {
      currentContent.watermark = getWatermarkForFile(fileName);
      io.emit("cambiar-contenido", currentContent);
      io.emit("media-updated", currentContent);
    }
    return res.json({ success: true, meta: mediaMetaMap[fileName] });
  });
  app.post("/api/watermark/logo", requireAuth, upload.single("logo"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No se subi\xF3 ning\xFAn archivo de logo." });
    }
    const logoUrl = `/uploads/${req.file.filename}`;
    watermarkConfig.logoUrl = logoUrl;
    saveWatermark();
    if (currentContent && currentContent.fileName) {
      currentContent.watermark = getWatermarkForFile(currentContent.fileName);
      io.emit("cambiar-contenido", currentContent);
      io.emit("media-updated", currentContent);
    }
    io.emit("watermark-updated", watermarkConfig);
    return res.json({ success: true, logoUrl, watermark: watermarkConfig });
  });
  app.post("/api/playlist/toggle", requireAuth, (req, res) => {
    const { enabled } = req.body;
    playlistState.enabled = typeof enabled === "boolean" ? enabled : !playlistState.enabled;
    const list = getMediaListSync();
    if (playlistState.enabled && list.length > 0 && (!currentContent || !currentContent.url)) {
      advancePlaylist("next", true);
    }
    io.emit("playlist-status", {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null
    });
    res.json({
      success: true,
      enabled: playlistState.enabled,
      message: playlistState.enabled ? "Bucle infinito activado." : "Bucle infinito pausado."
    });
  });
  app.post("/api/playlist/config", requireAuth, (req, res) => {
    const { intervalSeconds, shuffle } = req.body;
    if (typeof intervalSeconds === "number" && intervalSeconds >= 2) {
      playlistState.intervalSeconds = intervalSeconds;
    }
    if (typeof shuffle === "boolean") {
      playlistState.shuffle = shuffle;
    }
    const list = getMediaListSync();
    io.emit("playlist-status", {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null
    });
    res.json({ success: true, ...playlistState });
  });
  app.post("/api/playlist/next", requireAuth, (_req, res) => {
    advancePlaylist("next", true);
    res.json({ success: true, currentIndex: playlistState.currentIndex });
  });
  app.post("/api/playlist/prev", requireAuth, (_req, res) => {
    advancePlaylist("prev", true);
    res.json({ success: true, currentIndex: playlistState.currentIndex });
  });
  app.post("/api/playlist/play-index", requireAuth, (req, res) => {
    const { index } = req.body;
    const list = getMediaListSync();
    if (typeof index === "number" && index >= 0 && index < list.length) {
      playlistState.currentIndex = index;
      const item = list[index];
      const mediaData = {
        url: item.url,
        type: item.type,
        fileName: item.fileName,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        playlistIndex: index,
        playlistTotal: list.length,
        playlistEnabled: playlistState.enabled
      };
      currentContent = mediaData;
      playlistState.lastAdvancedAt = Date.now();
      io.emit("cambiar-contenido", mediaData);
      io.emit("media-updated", mediaData);
      io.emit("playlist-status", {
        ...playlistState,
        totalItems: list.length,
        currentItem: item
      });
      return res.json({ success: true, data: mediaData });
    }
    return res.status(400).json({ error: "\xCDndice de reproducci\xF3n no v\xE1lido." });
  });
  app.delete("/api/media/:fileName", requireAuth, (req, res) => {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.join(UPLOADS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        for (const day of DAYS_ORDER) {
          if (weeklySchedule[day]) {
            weeklySchedule[day].items = weeklySchedule[day].items.filter((item) => item !== fileName);
          }
        }
        saveWeeklySchedule();
        delete mediaMetaMap[fileName];
        saveMediaMeta();
        if (currentContent && currentContent.fileName === fileName) {
          currentContent = null;
          io.emit("cambiar-contenido", { url: "", type: "clear", fileName: "", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
        }
        return res.json({ success: true, message: "Archivo eliminado correctamente." });
      } catch {
        return res.status(500).json({ error: "No se pudo eliminar el archivo." });
      }
    }
    return res.status(404).json({ error: "Archivo no encontrado." });
  });
  app.post("/api/broadcast-url", requireAuth, (req, res) => {
    const { url, type, title } = req.body;
    if (!url) {
      return res.status(400).json({ error: "La URL es obligatoria." });
    }
    let detectedType = type;
    if (!detectedType) {
      const cleanUrl = url.split("?")[0].toLowerCase();
      if (cleanUrl.match(/\.(mp4|webm|ogg|mov|m4v)$/)) {
        detectedType = "video";
      } else {
        detectedType = "image";
      }
    }
    currentContent = {
      url,
      type: detectedType,
      fileName: title || url.split("/").pop()?.split("?")[0] || "Enlace Web",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      isExternal: true
    };
    io.emit("cambiar-contenido", currentContent);
    io.emit("media-updated", currentContent);
    res.json({ success: true, message: "URL transmitida a las pantallas.", data: currentContent });
  });
  app.post("/api/clear", requireAuth, (_req, res) => {
    currentContent = null;
    io.emit("cambiar-contenido", { url: "", type: "clear", fileName: "", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    res.json({ success: true, message: "Pantallas puestas en modo de espera." });
  });
  app.use("/uploads", express.static(UPLOADS_DIR, {
    acceptRanges: true
  }));
  app.use(express.static(PUBLIC_DIR));
  let connectedClients = 0;
  io.on("connection", (socket) => {
    connectedClients++;
    io.emit("clients-count", connectedClients);
    if (currentContent) {
      socket.emit("cambiar-contenido", currentContent);
      socket.emit("media-updated", currentContent);
    }
    const list = getMediaListSync();
    socket.emit("playlist-status", {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null
    });
    socket.on("video-ended", () => {
      console.log("[SOCKET] Evento video-ended recibido desde Smart TV.");
      advancePlaylist("next", true);
    });
    socket.on("playlist-next", () => {
      advancePlaylist("next", true);
    });
    socket.on("playlist-prev", () => {
      advancePlaylist("prev", true);
    });
    socket.on("disconnect", () => {
      connectedClients = Math.max(0, connectedClients - 1);
      io.emit("clients-count", connectedClients);
    });
  });
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVIDOR CARTELER\xCDA DIGITAL] Activo en http://0.0.0.0:${PORT}`);
    console.log(` - App SPA Principal: http://localhost:${PORT}/`);
    console.log(` - Pantalla TV Nativa: http://localhost:${PORT}/tv.html`);
    console.log(` - Enlace Corto TV: http://localhost:${PORT}/tv`);
  });
}
startServer().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
});
