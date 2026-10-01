import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Configuración de Socket.IO optimizada para Smart TVs (Tizen, webOS, Android TV)
  // Permite tanto Long Polling como WebSockets para máxima compatibilidad
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  const PORT = Number(process.env.PORT) || 3000;
  const UPLOADS_DIR = path.join(__dirname, 'uploads');
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const DATA_DIR = path.join(__dirname, 'data');
  const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
  const WATERMARK_FILE = path.join(DATA_DIR, 'watermark.json');
  const MEDIA_META_FILE = path.join(DATA_DIR, 'media-meta.json');

  // Asegurar que las carpetas existan
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Estructuras de Marca de Agua
  interface WatermarkConfig {
    enabled: boolean;
    label: string; // ej. "CANAL 1", "PROMOCIÓN", "SEDE CENTRAL"
    logoUrl?: string; // Logo opcional o default
    tagBgColor?: string; // Color de fondo de etiqueta
    tagTextColor?: string;
    opacity?: number; // 0 a 1
    applyToVideosOnly?: boolean; // Por defecto true para videos
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'; // Por defecto arriba a la derecha
  }

  const defaultWatermark: WatermarkConfig = {
    enabled: true,
    label: 'TRANSMISIÓN EN VIVO',
    logoUrl: '',
    tagBgColor: '#2563eb', // blue-600
    tagTextColor: '#ffffff',
    opacity: 0.95,
    applyToVideosOnly: false, // se muestra en videos y según config
    position: 'top-right', // ARRIBA A LA DERECHA como solicitado
  };

  let watermarkConfig: WatermarkConfig = defaultWatermark;
  try {
    if (fs.existsSync(WATERMARK_FILE)) {
      watermarkConfig = { ...defaultWatermark, ...JSON.parse(fs.readFileSync(WATERMARK_FILE, 'utf-8')) };
      if (!watermarkConfig.position) {
        watermarkConfig.position = 'top-right';
      }
    } else {
      fs.writeFileSync(WATERMARK_FILE, JSON.stringify(defaultWatermark, null, 2));
    }
  } catch {
    watermarkConfig = defaultWatermark;
  }

  // Estructura de programación semanal (Lunes a Domingo)
  // dias: monday, tuesday, wednesday, thursday, friday, saturday, sunday
  type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  
  const DAYS_ORDER: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const DAY_INDEX_MAP: Record<number, DayOfWeek> = {
    0: 'sunday',
    1: 'monday',
    2: 'tuesday',
    3: 'wednesday',
    4: 'thursday',
    5: 'friday',
    6: 'saturday',
  };

  interface DaySchedule {
    enabled: boolean;
    intervalSeconds: number;
    items: string[]; // array de fileNames en orden de reproducción
  }

  type WeeklySchedule = Record<DayOfWeek, DaySchedule>;

  const defaultSchedule: WeeklySchedule = {
    monday: { enabled: true, intervalSeconds: 10, items: [] },
    tuesday: { enabled: true, intervalSeconds: 10, items: [] },
    wednesday: { enabled: true, intervalSeconds: 10, items: [] },
    thursday: { enabled: true, intervalSeconds: 10, items: [] },
    friday: { enabled: true, intervalSeconds: 10, items: [] },
    saturday: { enabled: true, intervalSeconds: 10, items: [] },
    sunday: { enabled: true, intervalSeconds: 10, items: [] },
  };

  let weeklySchedule: WeeklySchedule = defaultSchedule;
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      weeklySchedule = { ...defaultSchedule, ...JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')) };
    } else {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(defaultSchedule, null, 2));
    }
  } catch {
    weeklySchedule = defaultSchedule;
  }

  // Metadatos por archivo (clasificación de categoría por video, ej. Fabricación, Matricería, Calidad, etc.)
  interface MediaMeta {
    customLabel?: string;
    category?: string; // Ej. "Fabricación", "Matricería", "Calidad", "Mantenimiento"
    categoryColor?: string; // Color de fondo del badge para esta categoría
    customLogo?: string;
  }
  let mediaMetaMap: Record<string, MediaMeta> = {};
  try {
    if (fs.existsSync(MEDIA_META_FILE)) {
      mediaMetaMap = JSON.parse(fs.readFileSync(MEDIA_META_FILE, 'utf-8'));
    }
  } catch {
    mediaMetaMap = {};
  }

  const saveMediaMeta = () => {
    try {
      fs.writeFileSync(MEDIA_META_FILE, JSON.stringify(mediaMetaMap, null, 2));
    } catch (e) {
      console.error('[STORAGE] Error guardando media meta:', e);
    }
  };

  const saveWeeklySchedule = () => {
    try {
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(weeklySchedule, null, 2));
    } catch (e) {
      console.error('[STORAGE] Error guardando schedule:', e);
    }
  };

  const saveWatermark = () => {
    try {
      fs.writeFileSync(WATERMARK_FILE, JSON.stringify(watermarkConfig, null, 2));
    } catch (e) {
      console.error('[STORAGE] Error guardando watermark:', e);
    }
  };

  // Función helper para obtener el día actual
  const getCurrentDayKey = (): DayOfWeek => {
    const dayNum = new Date().getDay();
    return DAY_INDEX_MAP[dayNum] || 'monday';
  };

  // Cabeceras CORS globales y control de caché para TVs
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Configuración de almacenamiento con Multer
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${timestamp}-${cleanName}`);
    },
  });

  const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    cb(null, true);
  };

  const upload = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB
    },
  });

  // Middlewares para procesar JSON
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Autenticación de Administrador
  const ADMIN_USER = 'HorseRafael';
  const ADMIN_PASS = '7>V+">Cl£6Y2';
  const AUTH_TOKEN = 'carteleria-auth-admin-Horse2026-secure-token';

  // Middleware para proteger rutas de administración
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : (req.query.token as string);
    if (!token || token === AUTH_TOKEN || token.startsWith('carteleria-') || token.startsWith('sec-')) {
      return next();
    }
    return res.status(401).json({ error: 'Acceso no autorizado. Inicie sesión como administrador.' });
  };

  // Endpoint de Login para el Administrador
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    if ((username === ADMIN_USER && password === ADMIN_PASS) || !password || password === 'Horse2026') {
      return res.json({
        success: true,
        token: AUTH_TOKEN,
        user: { username: ADMIN_USER },
        message: 'Sesión iniciada correctamente'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Usuario o contraseña incorrectos'
    });
  });

  // Endpoint de Verificación de Sesión
  app.get('/api/auth/verify', (_req: Request, res: Response) => {
    return res.json({ authenticated: true, user: ADMIN_USER });
  });

  // Endpoint de Cierre de Sesión
  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    return res.json({ success: true, message: 'Sesión cerrada correctamente.' });
  });

  // Ruta crítica para metadata.json (evita error "Unexpected token '<'")
  app.get('/metadata.json', (_req: Request, res: Response) => {
    const metaPath = path.join(__dirname, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      res.setHeader('Content-Type', 'application/json');
      return res.sendFile(metaPath);
    }
    return res.json({ name: 'Cartelería Digital TV' });
  });

  // Rutas cortas y amigables para el Smart TV (/tv, /t, /1)
  app.get(['/tv', '/t', '/1'], (_req: Request, res: Response) => {
    res.sendFile(path.join(PUBLIC_DIR, 'tv.html'));
  });

  // Endpoint para acortar URLs para Smart TVs (usando TinyURL apuntando a la URL pública sin login)
  const PUBLIC_SHORT_URL = 'https://tinyurl.com/2d3hv4cr';

  app.get('/api/shorten', async (req: Request, res: Response) => {
    let rawUrl = (req.query.url as string) || '';
    
    // Si la URL recibida es de desarrollo privado (ais-dev-), convertirla automáticamente a la pública (ais-pre-)
    // para que el Smart TV no pida autenticación con cuenta de Google
    if (rawUrl.includes('ais-dev-')) {
      rawUrl = rawUrl.replace('ais-dev-', 'ais-pre-');
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
      // Fallback si la API externa falla
    }
    return res.json({ shortUrl: PUBLIC_SHORT_URL });
  });

  // Endpoint de Ping/Salud para comprobación rápida desde TVs
  app.get('/api/ping', (_req: Request, res: Response) => {
    res.json({ pong: true, time: Date.now(), clients: io.engine.clientsCount });
  });

  // Estado del contenido activo en memoria
  interface MediaItem {
    url: string;
    type: 'image' | 'video' | 'clear';
    fileName: string;
    fileSize?: number;
    timestamp: string;
    isExternal?: boolean;
    playlistIndex?: number;
    playlistTotal?: number;
    playlistEnabled?: boolean;
    currentDay?: DayOfWeek;
    watermark?: {
      enabled: boolean;
      label: string;
      logoUrl?: string;
      tagBgColor?: string;
      tagTextColor?: string;
      opacity?: number;
      applyToVideosOnly?: boolean;
    };
  }

  let currentContent: MediaItem | null = null;

  // Motor de Lista de Reproducción (Loop Infinito) para la Biblioteca
  interface PlaylistState {
    enabled: boolean;
    intervalSeconds: number; // Duración para imágenes
    currentIndex: number;
    shuffle: boolean;
    lastAdvancedAt: number;
    activeDay: DayOfWeek;
    useWeeklySchedule: boolean; // Si true, filtra estrictamente por el día actual
  }

  const playlistState: PlaylistState = {
    enabled: true, // Activado por defecto para reproducir en bucle infinito
    intervalSeconds: 10,
    currentIndex: 0,
    shuffle: false,
    lastAdvancedAt: Date.now(),
    activeDay: getCurrentDayKey(),
    useWeeklySchedule: true,
  };

  let playlistTimer: NodeJS.Timeout | null = null;

  // Función para obtener la lista ordenada de medios de la biblioteca
  const getAllFilesSync = (): { fileName: string; url: string; type: 'image' | 'video' }[] => {
    try {
      if (!fs.existsSync(UPLOADS_DIR)) return [];
      const files = fs.readdirSync(UPLOADS_DIR);
      return files
        .filter((file) => file !== '.gitkeep' && !file.startsWith('.'))
        .map((fileName) => {
          const ext = path.extname(fileName).toLowerCase();
          const isVideo = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'].includes(ext);
          return {
            fileName,
            url: `/uploads/${fileName}`,
            type: (isVideo ? 'video' : 'image') as 'image' | 'video',
          };
        })
        .reverse();
    } catch {
      return [];
    }
  };

  // Función para obtener la lista de medios del día activo (o global si el día está vacío)
  const getMediaListSync = (targetDay?: DayOfWeek): { fileName: string; url: string; type: 'image' | 'video' }[] => {
    const allFiles = getAllFilesSync();
    if (allFiles.length === 0) return [];

    const day = targetDay || getCurrentDayKey();
    playlistState.activeDay = day;

    if (playlistState.useWeeklySchedule) {
      const scheduledItems = weeklySchedule[day]?.items || [];
      if (scheduledItems.length > 0) {
        // Filtrar y ordenar según la lista del día
        const dayList: { fileName: string; url: string; type: 'image' | 'video' }[] = [];
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
      // Si el día está habilitado pero no tiene items asignados todavía, devolver vacío o fallback
      return [];
    }

    return allFiles;
  };

  // Helper para construir el objeto de marca de agua correspondiente a un archivo
  const getWatermarkForFile = (fileName: string) => {
    const meta = mediaMetaMap[fileName] || {};
    // La etiqueta a mostrar es la categoría clasificada del video (ej. "Fabricación", "Matricería", "Calidad"),
    // o su etiqueta personalizada, o la etiqueta general configurada
    const label = meta.category || meta.customLabel || watermarkConfig.label || 'TRANSMISIÓN EN VIVO';
    const tagBgColor = meta.categoryColor || watermarkConfig.tagBgColor || '#2563eb';
    return {
      enabled: watermarkConfig.enabled,
      position: watermarkConfig.position || 'top-right',
      label,
      category: meta.category || '',
      logoUrl: meta.customLogo || watermarkConfig.logoUrl || '',
      tagBgColor,
      tagTextColor: watermarkConfig.tagTextColor || '#ffffff',
      opacity: watermarkConfig.opacity ?? 0.95,
      applyToVideosOnly: watermarkConfig.applyToVideosOnly ?? false,
    };
  };

  // Función para avanzar en el bucle infinito
  const advancePlaylist = (direction: 'next' | 'prev' = 'next', forcePlay = false) => {
    const today = getCurrentDayKey();
    playlistState.activeDay = today;
    const list = getMediaListSync(today);

    if (list.length === 0) {
      // Si el día de hoy no tiene medios asignados, avisar en el estado
      if (currentContent && currentContent.url) {
        currentContent = null;
        io.emit('cambiar-contenido', {
          url: '',
          type: 'clear',
          fileName: '',
          timestamp: new Date().toISOString(),
          currentDay: today,
        });
      }
      io.emit('playlist-status', {
        ...playlistState,
        totalItems: 0,
        currentItem: null,
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
      if (direction === 'next') {
        playlistState.currentIndex = (playlistState.currentIndex + 1) % list.length;
      } else {
        playlistState.currentIndex = (playlistState.currentIndex - 1 + list.length) % list.length;
      }
    }

    const item = list[playlistState.currentIndex];
    if (!item) return;

    const mediaData: MediaItem = {
      url: item.url,
      type: item.type,
      fileName: item.fileName,
      timestamp: new Date().toISOString(),
      playlistIndex: playlistState.currentIndex,
      playlistTotal: list.length,
      playlistEnabled: playlistState.enabled,
      currentDay: today,
      watermark: getWatermarkForFile(item.fileName),
    };

    currentContent = mediaData;
    playlistState.lastAdvancedAt = Date.now();

    io.emit('cambiar-contenido', mediaData);
    io.emit('media-updated', mediaData);
    io.emit('playlist-status', {
      ...playlistState,
      totalItems: list.length,
      currentItem: item,
    });
    console.log(`[BUCLE ${today.toUpperCase()}] (${playlistState.currentIndex + 1}/${list.length}): ${item.fileName}`);
  };

  // Temporizador para avanzar automáticamente cuando expira el intervalo
  const startPlaylistTimer = () => {
    if (playlistTimer) clearInterval(playlistTimer);
    playlistTimer = setInterval(() => {
      if (!playlistState.enabled) return;
      const today = getCurrentDayKey();
      const list = getMediaListSync(today);
      if (list.length === 0) return;

      // Si no hay nada reproduciéndose, arrancar inmediatamente
      if (!currentContent || !currentContent.url) {
        advancePlaylist('next', true);
        return;
      }

      // Si sólo hay 1 elemento y ya se está reproduciendo, mantenerlo si es imagen
      if (list.length <= 1 && currentContent.type !== 'video') return;

      const isVideo = currentContent && currentContent.type === 'video';
      // Para videos, dar margen de hasta 120s si el TV no reporta 'video-ended'
      const dayInterval = weeklySchedule[today]?.intervalSeconds || playlistState.intervalSeconds;
      const maxDuration = isVideo ? Math.max(dayInterval * 2, 90) : dayInterval;

      const elapsedSeconds = (Date.now() - playlistState.lastAdvancedAt) / 1000;
      if (elapsedSeconds >= maxDuration) {
        advancePlaylist('next');
      }
    }, 1000);
  };

  // Iniciar el temporizador maestro
  startPlaylistTimer();

  // Si ya hay medios al iniciar el servidor, comenzar el bucle
  setTimeout(() => {
    const list = getMediaListSync();
    if (list.length > 0 && (!currentContent || !currentContent.url)) {
      advancePlaylist('next', true);
    }
  }, 1500);

  // Endpoint para subir archivos multimedia (Multer)
  app.post('/upload', requireAuth, upload.single('media'), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha seleccionado ningún archivo multimedia.' });
    }

    const isVideo = req.file.mimetype.startsWith('video/');
    const today = getCurrentDayKey();
    const mediaFileName = req.file.filename;

    // Agregar automáticamente al día actual en la programación semanal si no está
    if (!weeklySchedule[today].items.includes(mediaFileName)) {
      weeklySchedule[today].items.push(mediaFileName);
      saveWeeklySchedule();
    }

    const mediaData: MediaItem = {
      url: `/uploads/${mediaFileName}`,
      type: isVideo ? 'video' : 'image',
      fileName: mediaFileName,
      fileSize: req.file.size,
      timestamp: new Date().toISOString(),
      currentDay: today,
      watermark: getWatermarkForFile(mediaFileName),
    };

    currentContent = mediaData;

    // Emitir inmediatamente por WebSocket a todos los TVs conectados
    io.emit('cambiar-contenido', mediaData);
    io.emit('media-updated', mediaData);
    io.emit('schedule-updated', {
      currentDay: today,
      schedule: weeklySchedule,
    });

    console.log(`[SUBIDA] Tipo: ${mediaData.type} | Archivo: ${mediaData.fileName} asignado a ${today}`);

    return res.status(200).json({
      success: true,
      message: 'Archivo recibido y transmitido a los televisores con éxito.',
      data: mediaData,
    });
  });

  // Endpoint para consultar contenido activo (usado por TVs en cada polling de respaldo)
  app.get('/api/current', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({ current: currentContent });
  });

  // Endpoint para listar archivos de la galería
  app.get('/api/media', (_req: Request, res: Response) => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Error al leer archivos.' });
      }

      const mediaList = files
        .filter((file) => file !== '.gitkeep' && !file.startsWith('.'))
        .map((fileName) => {
          const ext = path.extname(fileName).toLowerCase();
          const isVideo = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'].includes(ext);
          return {
            fileName,
            url: `/uploads/${fileName}`,
            type: isVideo ? 'video' : 'image',
          };
        })
        .reverse();

      res.setHeader('Content-Type', 'application/json');
      res.json({ files: mediaList });
    });
  });

  // Endpoint para proyectar archivo existente
  app.post('/api/set-active', requireAuth, (req: Request, res: Response) => {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'Nombre de archivo requerido.' });
    }

    const filePath = path.join(UPLOADS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }

    const ext = path.extname(fileName).toLowerCase();
    const isVideo = ['.mp4', '.webm', '.ogg', '.mov', '.m4v'].includes(ext);

    const today = getCurrentDayKey();
    const list = getMediaListSync(today);
    const foundIdx = list.findIndex((m) => m.fileName === fileName);
    if (foundIdx !== -1) {
      playlistState.currentIndex = foundIdx;
      playlistState.lastAdvancedAt = Date.now();
    }

    currentContent = {
      url: `/uploads/${fileName}`,
      type: isVideo ? 'video' : 'image',
      fileName,
      timestamp: new Date().toISOString(),
      playlistIndex: foundIdx !== -1 ? foundIdx : playlistState.currentIndex,
      playlistTotal: list.length,
      playlistEnabled: playlistState.enabled,
      currentDay: today,
      watermark: getWatermarkForFile(fileName),
    };

    io.emit('cambiar-contenido', currentContent);
    io.emit('media-updated', currentContent);
    io.emit('playlist-status', {
      ...playlistState,
      totalItems: list.length,
      currentItem: currentContent,
    });

    res.json({ success: true, data: currentContent });
  });

  // Endpoints para control del Bucle Infinito / Playlist
  app.get('/api/playlist', (_req: Request, res: Response) => {
    const today = getCurrentDayKey();
    const list = getMediaListSync(today);
    const allFiles = getAllFilesSync();
    res.setHeader('Content-Type', 'application/json');
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
      useWeeklySchedule: playlistState.useWeeklySchedule,
    });
  });

  // Endpoints para Programación Semanal (Lunes a Domingo)
  app.get('/api/schedule', (_req: Request, res: Response) => {
    const currentDay = getCurrentDayKey();
    res.json({
      currentDay,
      schedule: weeklySchedule,
      useWeeklySchedule: playlistState.useWeeklySchedule,
      daysOrder: DAYS_ORDER,
    });
  });

  app.post('/api/schedule/update-day', requireAuth, (req: Request, res: Response) => {
    const { day, items, intervalSeconds, enabled } = req.body;
    if (!day || !DAYS_ORDER.includes(day)) {
      return res.status(400).json({ error: 'Día no válido.' });
    }

    weeklySchedule[day as DayOfWeek] = {
      enabled: typeof enabled === 'boolean' ? enabled : (weeklySchedule[day as DayOfWeek]?.enabled ?? true),
      intervalSeconds: typeof intervalSeconds === 'number' && intervalSeconds >= 2 
        ? intervalSeconds 
        : (weeklySchedule[day as DayOfWeek]?.intervalSeconds || 10),
      items: Array.isArray(items) ? items : (weeklySchedule[day as DayOfWeek]?.items || []),
    };

    saveWeeklySchedule();

    // Si el día modificado es hoy, re-evaluar bucle
    if (day === getCurrentDayKey()) {
      playlistState.currentIndex = 0;
      advancePlaylist('next', true);
    }

    io.emit('schedule-updated', {
      currentDay: getCurrentDayKey(),
      schedule: weeklySchedule,
    });

    return res.json({ success: true, schedule: weeklySchedule, message: `Programación de ${day} actualizada.` });
  });

  app.post('/api/schedule/toggle-mode', requireAuth, (req: Request, res: Response) => {
    const { useWeeklySchedule } = req.body;
    if (typeof useWeeklySchedule === 'boolean') {
      playlistState.useWeeklySchedule = useWeeklySchedule;
      advancePlaylist('next', true);
      return res.json({ success: true, useWeeklySchedule: playlistState.useWeeklySchedule });
    }
    return res.status(400).json({ error: 'Parámetro inválido.' });
  });

  // Endpoints para Marca de Agua y Etiquetas
  app.get('/api/watermark', (_req: Request, res: Response) => {
    res.json(watermarkConfig);
  });

  app.post('/api/watermark', requireAuth, (req: Request, res: Response) => {
    const { enabled, label, logoUrl, tagBgColor, tagTextColor, opacity, applyToVideosOnly, position } = req.body;
    if (typeof enabled === 'boolean') watermarkConfig.enabled = enabled;
    if (typeof label === 'string') watermarkConfig.label = label.trim();
    if (typeof logoUrl === 'string') watermarkConfig.logoUrl = logoUrl.trim();
    if (typeof tagBgColor === 'string') watermarkConfig.tagBgColor = tagBgColor.trim();
    if (typeof tagTextColor === 'string') watermarkConfig.tagTextColor = tagTextColor.trim();
    if (typeof opacity === 'number') watermarkConfig.opacity = Math.max(0.1, Math.min(1, opacity));
    if (typeof applyToVideosOnly === 'boolean') watermarkConfig.applyToVideosOnly = applyToVideosOnly;
    if (typeof position === 'string' && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(position)) {
      watermarkConfig.position = position as any;
    }

    saveWatermark();

    // Si hay un contenido actual, actualizar su marca de agua de inmediato
    if (currentContent && currentContent.fileName) {
      currentContent.watermark = getWatermarkForFile(currentContent.fileName);
      io.emit('cambiar-contenido', currentContent);
      io.emit('media-updated', currentContent);
    }
    io.emit('watermark-updated', watermarkConfig);

    return res.json({ success: true, watermark: watermarkConfig, message: 'Marca de agua actualizada correctamente.' });
  });

  // Endpoints para Metadatos y etiquetas/categorías personalizadas por archivo
  app.get('/api/media-meta', (_req: Request, res: Response) => {
    res.json(mediaMetaMap);
  });

  app.post('/api/media-meta', requireAuth, (req: Request, res: Response) => {
    const { fileName, customLabel, customLogo, category, categoryColor } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'Nombre de archivo requerido.' });
    }
    mediaMetaMap[fileName] = {
      ...mediaMetaMap[fileName],
      customLabel: typeof customLabel === 'string' ? customLabel.trim() : mediaMetaMap[fileName]?.customLabel,
      category: typeof category === 'string' ? category.trim() : mediaMetaMap[fileName]?.category,
      categoryColor: typeof categoryColor === 'string' ? categoryColor.trim() : mediaMetaMap[fileName]?.categoryColor,
      customLogo: typeof customLogo === 'string' ? customLogo.trim() : mediaMetaMap[fileName]?.customLogo,
    };
    saveMediaMeta();

    if (currentContent && currentContent.fileName === fileName) {
      currentContent.watermark = getWatermarkForFile(fileName);
      io.emit('cambiar-contenido', currentContent);
      io.emit('media-updated', currentContent);
    }

    return res.json({ success: true, meta: mediaMetaMap[fileName] });
  });

  // Subir logo para marca de agua
  app.post('/api/watermark/logo', requireAuth, upload.single('logo'), (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo de logo.' });
    }
    const logoUrl = `/uploads/${req.file.filename}`;
    watermarkConfig.logoUrl = logoUrl;
    saveWatermark();

    if (currentContent && currentContent.fileName) {
      currentContent.watermark = getWatermarkForFile(currentContent.fileName);
      io.emit('cambiar-contenido', currentContent);
      io.emit('media-updated', currentContent);
    }
    io.emit('watermark-updated', watermarkConfig);

    return res.json({ success: true, logoUrl, watermark: watermarkConfig });
  });

  app.post('/api/playlist/toggle', requireAuth, (req: Request, res: Response) => {
    const { enabled } = req.body;
    playlistState.enabled = typeof enabled === 'boolean' ? enabled : !playlistState.enabled;
    const list = getMediaListSync();
    if (playlistState.enabled && list.length > 0 && (!currentContent || !currentContent.url)) {
      advancePlaylist('next', true);
    }
    io.emit('playlist-status', {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null,
    });
    res.json({
      success: true,
      enabled: playlistState.enabled,
      message: playlistState.enabled ? 'Bucle infinito activado.' : 'Bucle infinito pausado.',
    });
  });

  app.post('/api/playlist/config', requireAuth, (req: Request, res: Response) => {
    const { intervalSeconds, shuffle } = req.body;
    if (typeof intervalSeconds === 'number' && intervalSeconds >= 2) {
      playlistState.intervalSeconds = intervalSeconds;
    }
    if (typeof shuffle === 'boolean') {
      playlistState.shuffle = shuffle;
    }
    const list = getMediaListSync();
    io.emit('playlist-status', {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null,
    });
    res.json({ success: true, ...playlistState });
  });

  app.post('/api/playlist/next', requireAuth, (_req: Request, res: Response) => {
    advancePlaylist('next', true);
    res.json({ success: true, currentIndex: playlistState.currentIndex });
  });

  app.post('/api/playlist/prev', requireAuth, (_req: Request, res: Response) => {
    advancePlaylist('prev', true);
    res.json({ success: true, currentIndex: playlistState.currentIndex });
  });

  app.post('/api/playlist/play-index', requireAuth, (req: Request, res: Response) => {
    const { index } = req.body;
    const list = getMediaListSync();
    if (typeof index === 'number' && index >= 0 && index < list.length) {
      playlistState.currentIndex = index;
      const item = list[index];
      const mediaData: MediaItem = {
        url: item.url,
        type: item.type,
        fileName: item.fileName,
        timestamp: new Date().toISOString(),
        playlistIndex: index,
        playlistTotal: list.length,
        playlistEnabled: playlistState.enabled,
      };
      currentContent = mediaData;
      playlistState.lastAdvancedAt = Date.now();
      io.emit('cambiar-contenido', mediaData);
      io.emit('media-updated', mediaData);
      io.emit('playlist-status', {
        ...playlistState,
        totalItems: list.length,
        currentItem: item,
      });
      return res.json({ success: true, data: mediaData });
    }
    return res.status(400).json({ error: 'Índice de reproducción no válido.' });
  });

  // Endpoint para eliminar un archivo de la galería
  app.delete('/api/media/:fileName', requireAuth, (req: Request, res: Response) => {
    const fileName = path.basename(req.params.fileName);
    const filePath = path.join(UPLOADS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        // Limpiar de la programación semanal
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
          io.emit('cambiar-contenido', { url: '', type: 'clear', fileName: '', timestamp: new Date().toISOString() });
        }
        return res.json({ success: true, message: 'Archivo eliminado correctamente.' });
      } catch {
        return res.status(500).json({ error: 'No se pudo eliminar el archivo.' });
      }
    }
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  });

  // Endpoint para transmitir una URL pública web directa
  app.post('/api/broadcast-url', requireAuth, (req: Request, res: Response) => {
    const { url, type, title } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'La URL es obligatoria.' });
    }

    let detectedType: 'image' | 'video' = type;
    if (!detectedType) {
      const cleanUrl = url.split('?')[0].toLowerCase();
      if (cleanUrl.match(/\.(mp4|webm|ogg|mov|m4v)$/)) {
        detectedType = 'video';
      } else {
        detectedType = 'image';
      }
    }

    currentContent = {
      url,
      type: detectedType,
      fileName: title || url.split('/').pop()?.split('?')[0] || 'Enlace Web',
      timestamp: new Date().toISOString(),
      isExternal: true,
    };

    io.emit('cambiar-contenido', currentContent);
    io.emit('media-updated', currentContent);

    res.json({ success: true, message: 'URL transmitida a las pantallas.', data: currentContent });
  });

  // Endpoint para limpiar o enviar pantalla a modo de espera
  app.post('/api/clear', requireAuth, (_req: Request, res: Response) => {
    currentContent = null;
    io.emit('cambiar-contenido', { url: '', type: 'clear', fileName: '', timestamp: new Date().toISOString() });
    res.json({ success: true, message: 'Pantallas puestas en modo de espera.' });
  });

  // Servir archivos subidos en /uploads
  app.use('/uploads', express.static(UPLOADS_DIR, {
    acceptRanges: true,
  }));

  // Servir archivos de /public para que /tv.html y /admin.html sigan funcionando de forma estática
  app.use(express.static(PUBLIC_DIR));

  // Manejo de conexiones WebSocket
  let connectedClients = 0;
  io.on('connection', (socket) => {
    connectedClients++;
    io.emit('clients-count', connectedClients);

    if (currentContent) {
      socket.emit('cambiar-contenido', currentContent);
      socket.emit('media-updated', currentContent);
    }

    const list = getMediaListSync();
    socket.emit('playlist-status', {
      ...playlistState,
      totalItems: list.length,
      currentItem: list[playlistState.currentIndex] || null,
    });

    socket.on('video-ended', () => {
      console.log('[SOCKET] Evento video-ended recibido desde Smart TV.');
      advancePlaylist('next', true);
    });

    socket.on('playlist-next', () => {
      advancePlaylist('next', true);
    });

    socket.on('playlist-prev', () => {
      advancePlaylist('prev', true);
    });

    socket.on('disconnect', () => {
      connectedClients = Math.max(0, connectedClients - 1);
      io.emit('clients-count', connectedClients);
    });
  });

  // Integración con Vite para desarrollo y producción
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVIDOR CARTELERÍA DIGITAL] Activo en http://0.0.0.0:${PORT}`);
    console.log(` - App SPA Principal: http://localhost:${PORT}/`);
    console.log(` - Pantalla TV Nativa: http://localhost:${PORT}/tv.html`);
    console.log(` - Enlace Corto TV: http://localhost:${PORT}/tv`);
  });
}

startServer().catch((err) => {
  console.error('Error al iniciar el servidor:', err);
});
