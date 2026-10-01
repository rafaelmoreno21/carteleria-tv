import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Tv, 
  Upload, 
  Play, 
  RefreshCw, 
  Maximize, 
  CheckCircle, 
  AlertTriangle, 
  QrCode, 
  Copy, 
  Eye, 
  EyeOff,
  Power, 
  Sliders, 
  Film, 
  Image as ImageIcon,
  ExternalLink,
  Trash2,
  Sparkles,
  Zap,
  Repeat,
  SkipForward,
  SkipBack,
  Pause,
  Shuffle,
  Clock,
  ListMusic,
  Lock,
  User,
  LogIn,
  LogOut,
  ShieldCheck,
  Calendar,
  Tag,
  Palette,
  GripVertical,
  Plus,
  X,
  Layers,
  Settings,
  Download
} from 'lucide-react';

type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

const DAYS_META: { key: DayOfWeek; label: string; short: string }[] = [
  { key: 'monday', label: 'Lunes', short: 'Lun' },
  { key: 'tuesday', label: 'Martes', short: 'Mar' },
  { key: 'wednesday', label: 'Miércoles', short: 'Mié' },
  { key: 'thursday', label: 'Jueves', short: 'Jue' },
  { key: 'friday', label: 'Viernes', short: 'Vie' },
  { key: 'saturday', label: 'Sábado', short: 'Sáb' },
  { key: 'sunday', label: 'Domingo', short: 'Dom' },
];

interface WatermarkConfig {
  enabled: boolean;
  label: string;
  category?: string;
  logoUrl?: string;
  tagBgColor?: string;
  tagTextColor?: string;
  opacity?: number;
  applyToVideosOnly?: boolean;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

interface DaySchedule {
  enabled: boolean;
  intervalSeconds: number;
  items: string[];
}

type WeeklySchedule = Record<DayOfWeek, DaySchedule>;

interface MediaData {
  url: string;
  type: 'image' | 'video' | 'clear';
  fileName: string;
  fileSize?: number;
  timestamp?: string;
  isExternal?: boolean;
  playlistIndex?: number;
  playlistTotal?: number;
  playlistEnabled?: boolean;
  currentDay?: DayOfWeek;
  watermark?: WatermarkConfig;
}

interface ServerFile {
  fileName: string;
  url: string;
  type: 'image' | 'video';
}

interface PlaylistInfo {
  enabled: boolean;
  intervalSeconds: number;
  currentIndex: number;
  shuffle: boolean;
  totalItems: number;
  items: ServerFile[];
  allItems?: ServerFile[];
  currentItem: ServerFile | null;
  activeDay?: DayOfWeek;
  useWeeklySchedule?: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'admin' | 'tv-mode'>('admin');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedClients, setConnectedClients] = useState(1);
  const [currentMedia, setCurrentMedia] = useState<MediaData | null>(null);

  // Autenticación de Administrador
  const [authToken, setAuthToken] = useState<string>(() => {
    return localStorage.getItem('carteleria_auth_token') || sessionStorage.getItem('carteleria_auth_token') || '';
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('carteleria_auth_token') || sessionStorage.getItem('carteleria_auth_token'));
  });
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Estado del Bucle Infinito / Lista de Reproducción
  const [playlist, setPlaylist] = useState<PlaylistInfo>({
    enabled: true,
    intervalSeconds: 10,
    currentIndex: 0,
    shuffle: false,
    totalItems: 0,
    items: [],
    currentItem: null,
  });

  // Subida de archivos multimedia
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Biblioteca en servidor
  const [galleryFiles, setGalleryFiles] = useState<ServerFile[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  // Enlace corto para el Smart TV (TinyURL público sin requerir login)
  const [shortTvUrl, setShortTvUrl] = useState('https://tinyurl.com/2d3hv4cr');
  const [loadingShortUrl, setLoadingShortUrl] = useState(false);

  // Estados de Programación Semanal y Marca de Agua
  const [currentDayKey, setCurrentDayKey] = useState<DayOfWeek>('monday');
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<DayOfWeek>('monday');
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklySchedule>({
    monday: { enabled: true, intervalSeconds: 10, items: [] },
    tuesday: { enabled: true, intervalSeconds: 10, items: [] },
    wednesday: { enabled: true, intervalSeconds: 10, items: [] },
    thursday: { enabled: true, intervalSeconds: 10, items: [] },
    friday: { enabled: true, intervalSeconds: 10, items: [] },
    saturday: { enabled: true, intervalSeconds: 10, items: [] },
    sunday: { enabled: true, intervalSeconds: 10, items: [] },
  });
  const [useWeeklySchedule, setUseWeeklySchedule] = useState(true);

  // Configuración de Marca de Agua (solo logo transparente flotante arriba a la derecha)
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>({
    enabled: true,
    label: '',
    logoUrl: '',
    opacity: 0.95,
    applyToVideosOnly: false,
    position: 'top-right',
  });

  // Metadatos de archivos
  const [mediaMeta, setMediaMeta] = useState<Record<string, { customLabel?: string; category?: string; categoryColor?: string; customLogo?: string }>>({});

  // Estados interactivos para Drag and Drop (Arrastrar y Soltar videos a los días correspondientes)
  const [dragOverDay, setDragOverDay] = useState<DayOfWeek | null>(null);
  const [isDayDropZoneActive, setIsDayDropZoneActive] = useState(false);
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [dragOverItemIndex, setDragOverItemIndex] = useState<number | null>(null);

  // Pestaña activa del panel de control
  const [adminSubTab, setAdminSubTab] = useState<'schedule' | 'watermark'>('schedule');

  // Logo file upload state
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Helper para cabeceras con autorización
  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  // URL base activa
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentTvUrl = `${currentOrigin}/tv`;

  // Inicializar conexión Socket.io
  useEffect(() => {
    const s = io({
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 15,
    });
    setSocket(s);

    s.on('connect', () => {
      setConnected(true);
      fetchCurrentMedia();
      fetchGallery();
      fetchPlaylistStatus();
    });

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on('clients-count', (count: number) => {
      setConnectedClients(count);
    });

    s.on('cambiar-contenido', (data: MediaData) => {
      setCurrentMedia(data);
      fetchGallery();
      fetchPlaylistStatus();
    });

    s.on('media-updated', (data: MediaData) => {
      setCurrentMedia(data);
      fetchPlaylistStatus();
    });

    s.on('playlist-status', (status: PlaylistInfo) => {
      setPlaylist(status);
      if (status.activeDay) {
        setCurrentDayKey(status.activeDay);
      }
      if (typeof status.useWeeklySchedule === 'boolean') {
        setUseWeeklySchedule(status.useWeeklySchedule);
      }
    });

    s.on('schedule-updated', (data: { currentDay: DayOfWeek; schedule: WeeklySchedule }) => {
      if (data) {
        if (data.currentDay) setCurrentDayKey(data.currentDay);
        if (data.schedule) setWeeklySchedule(data.schedule);
      }
    });

    s.on('watermark-updated', (wm: WatermarkConfig) => {
      if (wm) setWatermarkConfig(wm);
    });

    // Obtener enlace acortado y estados
    fetchShortUrl();
    fetchPlaylistStatus();
    fetchSchedule();
    fetchWatermark();
    fetchMediaMeta();

    // Sondeo de respaldo periódico para mantener sincronizado el panel
    const interval = setInterval(() => {
      fetchCurrentMedia();
      fetchPlaylistStatus();
      fetchSchedule();
    }, 4000);

    return () => {
      clearInterval(interval);
      s.disconnect();
    };
  }, []);

  // Verificar validez del token guardado al iniciar
  useEffect(() => {
    if (authToken) {
      fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => {
          if (!res.ok) {
            handleLogout(false);
          }
        })
        .catch(() => {});
    }
  }, [authToken]);

  // Manejador de Inicio de Sesión
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.token) {
        setAuthToken(data.token);
        setIsAuthenticated(true);
        if (rememberMe) {
          localStorage.setItem('carteleria_auth_token', data.token);
          sessionStorage.removeItem('carteleria_auth_token');
        } else {
          sessionStorage.setItem('carteleria_auth_token', data.token);
          localStorage.removeItem('carteleria_auth_token');
        }
        showNotification('Acceso concedido. Bienvenido al panel de administración.', 'success');
        fetchGallery();
        fetchCurrentMedia();
        fetchPlaylistStatus();
        fetchShortUrl();
      } else {
        setLoginError(data.error || 'Usuario o contraseña incorrectos.');
      }
    } catch {
      setLoginError('Error de conexión con el servidor. Intente de nuevo.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Manejador de Cierre de Sesión
  const handleLogout = (notify = true) => {
    localStorage.removeItem('carteleria_auth_token');
    sessionStorage.removeItem('carteleria_auth_token');
    setAuthToken('');
    setIsAuthenticated(false);
    setLoginPassword('');
    setLoginError('');
    if (notify) {
      showNotification('Sesión de administrador cerrada correctamente.', 'info');
    }
  };

  // Helper para realizar peticiones JSON seguras (evita errores cuando el servidor devuelve HTML durante reinicios)
  const safeJsonFetch = async (url: string, options?: RequestInit) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) return null;
      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('<')) {
        return null;
      }
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  };

  const fetchShortUrl = async () => {
    try {
      setLoadingShortUrl(true);
      // Aseguramos que la URL apunte al dominio público ais-pre- (sin autenticación de Google)
      let targetOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      if (targetOrigin.includes('ais-dev-')) {
        targetOrigin = targetOrigin.replace('ais-dev-', 'ais-pre-');
      }
      const targetUrl = targetOrigin ? `${targetOrigin}/tv` : 'https://ais-pre-2gkdfaqhus4sld2xe3l7h6-792309613217.us-east1.run.app/tv';
      const data = await safeJsonFetch(`/api/shorten?url=${encodeURIComponent(targetUrl)}`);
      if (data && data.shortUrl) {
        setShortTvUrl(data.shortUrl);
      }
    } catch {
      setShortTvUrl('https://tinyurl.com/2d3hv4cr');
    } finally {
      setLoadingShortUrl(false);
    }
  };

  // Consultar estado actual
  const fetchCurrentMedia = async () => {
    const data = await safeJsonFetch(`/api/current?_t=${Date.now()}`);
    if (data) {
      if (data.current) {
        setCurrentMedia(data.current);
      } else {
        setCurrentMedia(null);
      }
    }
  };

  // Consultar archivos subidos
  const fetchGallery = async () => {
    const data = await safeJsonFetch(`/api/media?_t=${Date.now()}`);
    if (data && Array.isArray(data.files)) {
      setGalleryFiles(data.files);
    }
  };

  // Consultar estado de la lista de reproducción / bucle infinito
  const fetchPlaylistStatus = async () => {
    const data = await safeJsonFetch(`/api/playlist?_t=${Date.now()}`);
    if (data && typeof data.enabled === 'boolean') {
      setPlaylist(data);
      if (data.activeDay) {
        setCurrentDayKey(data.activeDay);
      }
      if (typeof data.useWeeklySchedule === 'boolean') {
        setUseWeeklySchedule(data.useWeeklySchedule);
      }
    }
  };

  const fetchSchedule = async () => {
    const data = await safeJsonFetch(`/api/schedule?_t=${Date.now()}`);
    if (data && data.schedule) {
      setWeeklySchedule(data.schedule);
      if (data.currentDay) {
        setCurrentDayKey(data.currentDay);
      }
      if (typeof data.useWeeklySchedule === 'boolean') {
        setUseWeeklySchedule(data.useWeeklySchedule);
      }
    }
  };

  const fetchWatermark = async () => {
    const data = await safeJsonFetch(`/api/watermark?_t=${Date.now()}`);
    if (data) {
      setWatermarkConfig(data);
    }
  };

  const fetchMediaMeta = async () => {
    const data = await safeJsonFetch(`/api/media-meta?_t=${Date.now()}`);
    if (data) {
      setMediaMeta(data);
    }
  };

  // Guardar configuración de marca de agua (fija arriba a la derecha y 100% nítida)
  const handleSaveWatermark = async (newConfig?: Partial<WatermarkConfig>) => {
    const payload = {
      ...(newConfig ? { ...watermarkConfig, ...newConfig } : watermarkConfig),
      position: 'top-right' as const,
      opacity: 1,
    };
    try {
      const res = await fetch('/api/watermark', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.watermark) {
        setWatermarkConfig(data.watermark);
        showNotification('Marca de agua actualizada con éxito.', 'success');
      }
    } catch {
      showNotification('Error al guardar marca de agua.', 'error');
    }
  };

  // Subir logo para marca de agua
  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
      setIsUploadingLogo(true);
      showNotification('Subiendo logo de marca de agua...', 'info');
      const res = await fetch('/api/watermark/logo', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.logoUrl) {
        setWatermarkConfig((prev) => ({ ...prev, logoUrl: data.logoUrl }));
        showNotification('Logo de marca de agua actualizado.', 'success');
      } else {
        showNotification(data.error || 'Error al subir logo.', 'error');
      }
    } catch {
      showNotification('Error al conectar con el servidor para subir logo.', 'error');
    } finally {
      setIsUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  // Actualizar lista de un día en la programación
  const handleUpdateDaySchedule = async (day: DayOfWeek, items: string[], intervalSeconds?: number, enabled?: boolean) => {
    try {
      const targetDay = weeklySchedule[day] || { enabled: true, intervalSeconds: 10, items: [] };
      const newItems = items;
      const newInterval = intervalSeconds ?? targetDay.intervalSeconds;
      const newEnabled = enabled ?? targetDay.enabled;

      const res = await fetch('/api/schedule/update-day', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          day,
          items: newItems,
          intervalSeconds: newInterval,
          enabled: newEnabled,
        }),
      });
      const data = await res.json();
      if (data.success && data.schedule) {
        setWeeklySchedule(data.schedule);
        showNotification(`Programación de ${DAYS_META.find((d) => d.key === day)?.label || day} actualizada.`, 'success');
        fetchCurrentMedia();
        fetchPlaylistStatus();
      }
    } catch {
      showNotification('Error al actualizar programación del día.', 'error');
    }
  };

  // Agregar archivo a un día de la semana
  const handleAddFileToDay = (day: DayOfWeek, fileName: string) => {
    const currentItems = weeklySchedule[day]?.items || [];
    if (!currentItems.includes(fileName)) {
      handleUpdateDaySchedule(day, [...currentItems, fileName]);
    } else {
      showNotification('Este archivo ya está asignado a este día.', 'info');
    }
  };

  // Quitar archivo de un día de la semana
  const handleRemoveFileFromDay = (day: DayOfWeek, fileName: string) => {
    const currentItems = weeklySchedule[day]?.items || [];
    handleUpdateDaySchedule(day, currentItems.filter((f) => f !== fileName));
  };

  // Reordenar items de un día
  const handleMoveDayItem = (day: DayOfWeek, fromIdx: number, toIdx: number) => {
    const currentItems = [...(weeklySchedule[day]?.items || [])];
    if (fromIdx < 0 || fromIdx >= currentItems.length || toIdx < 0 || toIdx >= currentItems.length) return;
    const [moved] = currentItems.splice(fromIdx, 1);
    currentItems.splice(toIdx, 0, moved);
    handleUpdateDaySchedule(day, currentItems);
  };

  // Subir archivo arrastrado desde la PC y asignarlo automáticamente al día correspondiente
  const handleUploadFileToDay = (file: File, day: DayOfWeek) => {
    setIsUploading(true);
    setUploadProgress(0);
    const dayLabel = DAYS_META.find((d) => d.key === day)?.label || day;
    showNotification(`Subiendo "${file.name}" y asignando a ${dayLabel}...`, 'info');

    const formData = new FormData();
    formData.append('media', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          const uploadedName = res.media?.fileName || file.name;
          showNotification(`"${uploadedName}" agregado con éxito al día ${dayLabel}.`, 'success');
          handleAddFileToDay(day, uploadedName);
          fetchGallery();
          fetchCurrentMedia();
        } catch {
          fetchGallery();
        }
      } else {
        showNotification('Error al subir el archivo.', 'error');
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      showNotification('Error de red al procesar el archivo.', 'error');
    };

    xhr.send(formData);
  };

  // Manejador de soltar archivo o medio en un día de la semana (botón de día o dropzone)
  const handleDropOnDay = (day: DayOfWeek, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverDay(null);
    setIsDayDropZoneActive(false);

    // 1. Si se soltó un archivo arrastrado desde el escritorio / explorador del ordenador
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          handleUploadFileToDay(file, day);
        } else {
          showNotification('Solo se permiten imágenes o videos.', 'error');
        }
      }
      return;
    }

    // 2. Si se soltó un medio de la biblioteca interna
    const fileName = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('fileName');
    if (fileName) {
      handleAddFileToDay(day, fileName);
    }
  };

  // Manejador de soltar para reordenar dentro del día seleccionado
  const handleDropReorder = (day: DayOfWeek, targetIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverItemIndex(null);
    const reorderFrom = e.dataTransfer.getData('reorderIndex');
    if (reorderFrom !== '' && reorderFrom !== undefined) {
      const fromIdx = parseInt(reorderFrom, 10);
      if (!isNaN(fromIdx) && fromIdx !== targetIdx) {
        handleMoveDayItem(day, fromIdx, targetIdx);
      }
      return;
    }

    // Si viene de la biblioteca, insertar en la posición objetivo targetIdx
    const fileName = e.dataTransfer.getData('text/plain');
    if (fileName) {
      const currentItems = [...(weeklySchedule[day]?.items || [])];
      const existingIdx = currentItems.indexOf(fileName);
      if (existingIdx !== -1) {
        currentItems.splice(existingIdx, 1);
      }
      currentItems.splice(targetIdx, 0, fileName);
      handleUpdateDaySchedule(day, currentItems);
      showNotification(`"${fileName}" ubicado en la posición ${targetIdx + 1} de ${day}.`, 'success');
    }
  };

  // Asignar archivo a TODOS los días
  const handleAddFileToAllDays = (fileName: string) => {
    DAYS_META.forEach((d) => {
      const items = weeklySchedule[d.key]?.items || [];
      if (!items.includes(fileName)) {
        handleUpdateDaySchedule(d.key, [...items, fileName]);
      }
    });
    showNotification(`"${fileName}" agregado a todos los días de la semana.`, 'success');
  };

  // Alternar modo de programación semanal estricta
  const handleToggleWeeklyMode = async () => {
    try {
      const res = await fetch('/api/schedule/toggle-mode', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ useWeeklySchedule: !useWeeklySchedule }),
      });
      const data = await res.json();
      if (data.success) {
        setUseWeeklySchedule(data.useWeeklySchedule);
        showNotification(
          data.useWeeklySchedule 
            ? 'Programación semanal por día ACTIVADA (Solo se emite lo del día correspondiente).'
            : 'Modo general activado (Se emite toda la biblioteca).',
          'info'
        );
        fetchCurrentMedia();
        fetchPlaylistStatus();
      }
    } catch {
      showNotification('Error al cambiar modo de programación.', 'error');
    }
  };

  // Alternar Bucle Infinito (Activar / Pausar)
  const handleTogglePlaylist = async () => {
    try {
      const res = await fetch('/api/playlist/toggle', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !playlist.enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setPlaylist((prev) => ({ ...prev, enabled: data.enabled }));
        showNotification(data.message, 'success');
        fetchCurrentMedia();
      }
    } catch {
      showNotification('Error al cambiar el estado del bucle.', 'error');
    }
  };

  // Siguiente elemento en el bucle
  const handlePlaylistNext = async () => {
    try {
      await fetch('/api/playlist/next', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      fetchCurrentMedia();
      fetchPlaylistStatus();
    } catch {}
  };

  // Elemento anterior en el bucle
  const handlePlaylistPrev = async () => {
    try {
      await fetch('/api/playlist/prev', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      fetchCurrentMedia();
      fetchPlaylistStatus();
    } catch {}
  };

  // Configurar duración de imagen (segundos)
  const handleSetInterval = async (seconds: number) => {
    try {
      const res = await fetch('/api/playlist/config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ intervalSeconds: seconds }),
      });
      const data = await res.json();
      if (data.success) {
        setPlaylist((prev) => ({ ...prev, intervalSeconds: seconds }));
        showNotification(`Duración de imágenes ajustada a ${seconds} segundos.`, 'info');
      }
    } catch {}
  };

  // Alternar orden aleatorio / secuencial
  const handleToggleShuffle = async () => {
    try {
      const newShuffle = !playlist.shuffle;
      const res = await fetch('/api/playlist/config', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ shuffle: newShuffle }),
      });
      const data = await res.json();
      if (data.success) {
        setPlaylist((prev) => ({ ...prev, shuffle: newShuffle }));
        showNotification(
          newShuffle ? 'Reproducción aleatoria activada en el bucle.' : 'Reproducción secuencial activada en el bucle.',
          'info'
        );
      }
    } catch {}
  };

  // Iniciar bucle desde un archivo específico
  const handlePlayFromItem = async (index: number) => {
    try {
      await fetch('/api/playlist/play-index', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ index }),
      });
      fetchCurrentMedia();
      fetchPlaylistStatus();
    } catch {}
  };

  const showNotification = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 4500);
  };

  // Manejar selección de archivo
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');

      if (!isVideo && !isImage) {
        showNotification('Solo se permiten archivos de imagen o video.', 'error');
        return;
      }

      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  // Subir archivo al backend con Multer
  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      showNotification('Selecciona un archivo multimedia primero.', 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('media', selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setUploadProgress(pct);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          showNotification(res.message || 'Contenido transmitido exitosamente a los televisores.', 'success');
          setSelectedFile(null);
          setPreviewUrl(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          fetchCurrentMedia();
          fetchGallery();
        } catch {
          showNotification('Archivo transmitido.', 'success');
        }
      } else if (xhr.status === 401) {
        showNotification('Sesión no autorizada o expirada. Por favor identifíquese.', 'error');
        handleLogout(false);
      } else {
        showNotification('Error al procesar la subida del archivo.', 'error');
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      showNotification('Error de red al subir el archivo.', 'error');
    };

    xhr.send(formData);
  };

  // Transmitir elemento existente de la galería
  const handleSelectGalleryItem = async (fileName: string) => {
    try {
      const res = await fetch('/api/set-active', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ fileName }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Transmitiendo "${fileName}" en televisores.`, 'success');
        fetchCurrentMedia();
      }
    } catch {
      showNotification('Error al proyectar archivo.', 'error');
    }
  };

  // Eliminar archivo de la biblioteca
  const handleDeleteGalleryItem = async (e: React.MouseEvent, fileName: string) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar "${fileName}" de la biblioteca?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/media/${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (res.ok) {
        showNotification(`Archivo "${fileName}" eliminado.`, 'info');
        fetchGallery();
        fetchCurrentMedia();
      } else {
        showNotification('No se pudo eliminar el archivo.', 'error');
      }
    } catch {
      showNotification('Error al eliminar archivo.', 'error');
    }
  };

  // Limpiar / Modo espera
  const handleClearScreen = async () => {
    try {
      const res = await fetch('/api/clear', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentMedia(null);
        showNotification('Pantallas puestas en modo de espera.', 'info');
      }
    } catch {
      showNotification('Error al limpiar pantallas.', 'error');
    }
  };

  // Copiar URL al portapapeles
  const handleCopyText = (text: string, label: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showNotification(`${label} copiado al portapapeles.`, 'success');
    }
  };

  // Si está en Modo Pantalla TV Completa
  if (activeTab === 'tv-mode') {
    return (
      <div className="fixed inset-0 bg-black text-white w-screen h-screen overflow-hidden flex items-center justify-center select-none z-50">
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2 opacity-30 hover:opacity-100 transition-opacity">
          {playlist.enabled && (
            <div className="bg-neutral-900/80 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 shadow">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              ⟳ Bucle Infinito ({typeof playlist.currentIndex === 'number' ? playlist.currentIndex + 1 : 1}/{galleryFiles.length})
            </div>
          )}
          <button
            onClick={() => setActiveTab('admin')}
            className="bg-neutral-800 text-neutral-200 border border-neutral-700 px-3 py-1.5 rounded-full text-xs font-medium hover:bg-neutral-700 flex items-center gap-1.5 shadow"
          >
            <Sliders className="w-3.5 h-3.5" />
            Panel Admin
          </button>
        </div>

        {currentMedia && currentMedia.url && currentMedia.type !== 'clear' ? (
          <>
            {currentMedia.type === 'video' ? (
              <video
                ref={videoRef}
                src={currentMedia.url}
                autoPlay
                loop={!playlist.enabled}
                onEnded={handlePlaylistNext}
                muted
                playsInline
                className="w-full h-full max-w-full max-h-full object-contain"
              />
            ) : (
              <img
                src={currentMedia.url}
                alt={currentMedia.fileName}
                className="w-full h-full max-w-full max-h-full object-contain"
              />
            )}

            {/* Marca de agua arriba a la derecha (solo logo transparente, sin recuadro ni etiqueta) */}
            {(() => {
              const wm = currentMedia.watermark || watermarkConfig;
              const isVideo = currentMedia.type === 'video';
              const show = wm && wm.enabled && (!wm.applyToVideosOnly || isVideo);
              if (!show) return null;
              const posClass = wm.position === 'top-left'
                ? 'top-7 left-7'
                : wm.position === 'bottom-left'
                ? 'bottom-7 left-7'
                : wm.position === 'bottom-right'
                ? 'bottom-7 right-7'
                : 'top-7 right-7'; // Arriba a la derecha por defecto
              return (
                <div
                  className={`absolute ${posClass} z-40 pointer-events-none transition-all duration-300`}
                  style={{ opacity: wm.opacity ?? 0.95 }}
                >
                  {wm.logoUrl ? (
                    <img
                      src={wm.logoUrl}
                      alt="Logo"
                      className="max-h-20 max-w-[240px] object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
                    />
                  ) : (
                    <div className="text-white/80 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                      <Tv className="w-10 h-10 text-white" />
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-6 text-neutral-400 gap-4">
            <div className="w-6 h-6 rounded-full bg-blue-600 animate-ping mb-2" />
            <div className="text-2xl font-bold tracking-widest text-white">PANTALLA CONECTADA</div>
            <div className="text-sm text-neutral-500 max-w-md">
              Esta pantalla se actualizará automáticamente cuando transmitas una imagen o video desde el panel web.
            </div>
            <div className="mt-4 px-3 py-1 rounded bg-neutral-900 border border-neutral-800 text-blue-400 font-mono text-xs">
              {shortTvUrl}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Si no está autenticado como administrador, mostrar pantalla de Login
  if (!isAuthenticated && activeTab === 'admin') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans select-none">
        {/* Luces y degradados decorativos de fondo */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md z-10 animate-fade-in">
          {/* Tarjeta de Inicio de Sesión */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            {/* Cabecera / Identidad */}
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-500/25 border border-blue-400/20">
                <Tv className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">Cartelería Digital TV</h1>
              <p className="text-xs text-slate-400 mt-1">Acceso seguro al panel de control y transmisión</p>
              <div className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[11px] text-slate-300">
                <Lock className="w-3 h-3 text-emerald-400" />
                <span>Acceso Restringido</span>
              </div>
            </div>

            {/* Alerta de Error */}
            {loginError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center gap-2 animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            {/* Formulario de Login */}
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Usuario
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Introduce la contraseña"
                    autoComplete="current-password"
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Recordar sesión</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-sm transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoggingIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Iniciando sesión...</span>
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>Entrar al Panel</span>
                  </>
                )}
              </button>
            </form>

  
          </div>

          {/* Acceso público directo a pantalla TV */}
          <div className="mt-4 text-center">
            <button
              onClick={() => setActiveTab('tv-mode')}
              className="text-xs text-slate-400 hover:text-blue-400 transition inline-flex items-center gap-1.5"
            >
              <Tv className="w-3.5 h-3.5 text-blue-400" />
              ¿Solo quieres ver la pantalla del Smart TV? Ir a Modo Pantalla TV
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Componente del Simulador de TV en Vivo (con TV 16:9, marco y marca de agua fija arriba a la derecha)
  const renderTvSimulator = () => (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-white">
            <Eye className="w-4 h-4 text-emerald-400" />
            Simulador de TV en Vivo
          </h2>
          <p className="text-[11px] text-slate-400">Vista sincronizada en tiempo real con las pantallas y televisores</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClearScreen}
            className="px-2.5 py-1 bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 rounded text-xs flex items-center gap-1.5 transition border border-slate-700 cursor-pointer"
            title="Poner en modo espera"
          >
            <Power className="w-3.5 h-3.5" />
            Modo Espera
          </button>
        </div>
      </div>

      {/* Pantalla Simulada del TV con marco */}
      <div className="p-4 sm:p-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-4xl aspect-video bg-black rounded-xl border-4 border-slate-800 relative overflow-hidden flex items-center justify-center shadow-2xl">
          {currentMedia && currentMedia.url && currentMedia.type !== 'clear' ? (
            <>
              {currentMedia.type === 'video' ? (
                <video
                  key={currentMedia.url}
                  src={currentMedia.url}
                  autoPlay
                  loop={!playlist.enabled}
                  onEnded={handlePlaylistNext}
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <img
                  key={currentMedia.url}
                  src={currentMedia.url}
                  alt={currentMedia.fileName}
                  className="w-full h-full object-contain"
                />
              )}

              {/* Marca de agua fija ARRIBA A LA DERECHA (solo logo transparente, sin recuadro ni fondo) */}
              {(() => {
                const wm = currentMedia.watermark || watermarkConfig;
                const isVideo = currentMedia.type === 'video';
                const show = wm && wm.enabled && (!wm.applyToVideosOnly || isVideo);
                if (!show) return null;
                return (
                  <div
                    className="absolute top-3 right-3 z-30 pointer-events-none transition-all"
                    style={{ opacity: wm.opacity ?? 0.95 }}
                  >
                    {wm.logoUrl ? (
                      <img
                        src={wm.logoUrl}
                        alt="Logo"
                        className="max-h-11 max-w-[130px] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                      />
                    ) : (
                      <div className="text-white/80 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                        <Tv className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-center p-6 text-slate-600 gap-2">
              <div className="w-3.5 h-3.5 rounded-full bg-blue-500/80 animate-pulse" />
              <span className="text-xs font-bold text-slate-400 tracking-wider">MODO ESPERA</span>
              <span className="text-[11px] text-slate-600 max-w-xs">
                No hay contenido transmitiéndose. Sube un archivo o elige uno de la biblioteca.
              </span>
            </div>
          )}
        </div>

        {/* Información del contenido proyectado */}
        <div className="w-full max-w-4xl mt-3 p-3 bg-slate-900/80 border border-slate-800/80 rounded-lg text-xs flex items-center justify-between">
          <div className="truncate mr-2">
            <span className="text-slate-400">Transmitiendo:</span>{' '}
            <span className="font-semibold text-white truncate">
              {currentMedia?.fileName || 'Ninguno (Modo Espera)'}
            </span>
          </div>
          <div>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-300">
              {currentMedia?.type || 'Espera'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header Superior */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-3 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight flex items-center gap-2 text-white">
                Cartelería Digital TV
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  En la Nube
                </span>
              </h1>
              <p className="text-xs text-slate-400">Transmisión multimedia a televisores sin instalar software</p>
            </div>
          </div>

          {/* Estado de red, usuario y accesos rápidos */}
          <div className="flex items-center flex-wrap gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-slate-300">{connected ? 'Servidor Conectado' : 'Conectando'}</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300">
              <Tv className="w-3.5 h-3.5 text-blue-400" />
              <span>{connectedClients} {connectedClients === 1 ? 'dispositivo' : 'dispositivos'}</span>
            </div>

            {/* Badge de usuario admin */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-xs text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium">admin</span>
            </div>

            {/* Botón Descargar Proyecto Completo ZIP */}
            <a
              href="/carteleria-tv-completo.zip"
              download="carteleria-tv-completo.zip"
              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold border border-amber-500 flex items-center gap-1.5 transition shadow"
              title="Descargar código completo del proyecto en archivo ZIP para usar en cualquier hosting"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar ZIP</span>
              <span className="sm:hidden">ZIP</span>
            </a>

            <button
              onClick={() => setShowQrModal(true)}
              className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-600 text-xs font-semibold text-white border border-blue-600 flex items-center gap-1.5 transition shadow"
              title="Ver código QR para Smart TV"
            >
              <QrCode className="w-3.5 h-3.5" />
              QR Smart TV
            </button>

            <a
              href="/tv.html"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1 transition shadow-sm"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              Ver en Pestaña
            </a>

            <button
              onClick={() => setActiveTab('tv-mode')}
              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition shadow-sm"
              title="Convertir esta pestaña en pantalla de TV completa"
            >
              <Maximize className="w-3.5 h-3.5" />
              Modo TV Completo
            </button>

            {/* Botón de Cerrar Sesión */}
            <button
              onClick={() => handleLogout(true)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-950 hover:border-rose-700 text-slate-300 hover:text-rose-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition shadow-sm"
              title="Cerrar sesión de administrador"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* TARJETA DESTACADA: ENLACE PARA SMART TV */}
      <div className="bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950/80 border-b border-blue-800/40 px-4 py-3.5 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm bg-blue-500/20 border border-blue-500/40 text-blue-400">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase font-bold tracking-wider text-blue-400">
                  Enlace para Smart TV
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Público • Sin Iniciar Sesión con Google
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Abre este enlace o escanea el QR en el navegador de tu televisor para transmitir en vivo:
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-end">
            <div className="bg-black/90 border border-blue-500/40 rounded-lg px-3.5 py-1.5 flex items-center gap-2 shadow-inner max-w-full overflow-hidden">
              <span className="text-xs text-blue-400 font-mono font-semibold flex items-center gap-1.5">
                <Tv className="w-3.5 h-3.5 text-blue-400" />
                URL TV:
              </span>
              <span className="text-xs font-mono text-emerald-300 truncate select-all font-semibold">
                {shortTvUrl || 'Cargando enlace...'}
              </span>
            </div>

            <button
              onClick={() => handleCopyText(shortTvUrl, 'Enlace para Smart TV')}
              disabled={!shortTvUrl}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition shadow-sm cursor-pointer"
              title="Copiar enlace del televisor"
            >
              <Copy className="w-3.5 h-3.5" />
              Copiar
            </button>

            <a
              href={shortTvUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded-lg font-semibold text-xs transition shadow-sm"
              title="Abrir pantalla TV en nueva pestaña"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              Abrir
            </a>

            <button
              onClick={() => setShowQrModal(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold text-xs transition shadow-sm cursor-pointer"
              title="Ver código QR para escanear en TV o móvil"
            >
              <QrCode className="w-3.5 h-3.5" />
              Ver Código QR
            </button>
          </div>
        </div>
      </div>

      {/* Notificación Toast */}
      {statusMessage && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md animate-fade-in">
          <div
            className={`px-4 py-3 rounded-lg shadow-lg border text-sm flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-100'
                : statusMessage.type === 'error'
                ? 'bg-rose-950 border-rose-700 text-rose-100'
                : 'bg-slate-800 border-slate-700 text-slate-200'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Pestañas de Navegación del Panel: Programación y Biblioteca vs Marca de Agua */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 shadow-sm max-w-xl w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setAdminSubTab('schedule')}
              className={`flex-1 sm:flex-none py-2 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                adminSubTab === 'schedule'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Programación y Biblioteca ({galleryFiles.length})</span>
              {useWeeklySchedule && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setAdminSubTab('watermark')}
              className={`flex-1 sm:flex-none py-2 px-4 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                adminSubTab === 'watermark'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Tv className="w-4 h-4" />
              <span>Marca de Agua y Logo</span>
              {watermarkConfig.enabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              )}
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 border border-slate-800/80 px-3 py-1.5 rounded-lg">
            <GripVertical className="w-3.5 h-3.5 text-blue-400" />
            <span>Biblioteca al <strong>lado izquierdo</strong> • Asignación de días al <strong>lado derecho</strong></span>
          </div>
        </div>

        {adminSubTab === 'schedule' ? (
          /* =========================================================================
             VISTA LADO A LADO:
             LADO IZQUIERDO: BIBLIOTECA MULTIMEDIA (y Carga de Archivos)
             LADO DERECHO: ASIGNACIÓN DE DÍAS Y SIMULADOR DE TV
             ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ==================== LADO IZQUIERDO: BIBLIOTECA ==================== */}
            <div className="lg:col-span-6 flex flex-col gap-6">
              
              {/* Card: Cargar y Transmitir Archivos Multimedia */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Upload className="w-4 h-4 text-blue-400" />
                      Cargar y Transmitir Archivos Multimedia
                    </h2>
                    <p className="text-[11px] text-slate-400">Sube imágenes o videos locales para sumarlos a la biblioteca</p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-800/40">
                    Imágenes y Videos
                  </span>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <form onSubmit={handleUploadSubmit} className="flex flex-col gap-3">
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-5 text-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/80 transition flex flex-col items-center justify-center gap-2 group"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        name="media"
                        accept="image/*,video/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <div className="w-10 h-10 rounded-full bg-blue-600/10 border border-blue-500/20 group-hover:scale-110 group-hover:bg-blue-600/20 transition flex items-center justify-center text-blue-400">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div className="text-xs font-semibold text-slate-200">
                        {selectedFile ? selectedFile.name : 'Haz clic para seleccionar o arrastra aquí tu archivo'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        MP4, WEBM, MOV, JPG, PNG, GIF, WEBP (hasta 500 MB)
                      </div>
                    </div>

                    {/* Vista previa del archivo seleccionado */}
                    {previewUrl && (
                      <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-3 animate-fade-in">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-14 h-10 bg-black rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 border border-slate-800">
                            {selectedFile?.type.startsWith('video/') ? (
                              <video src={previewUrl} className="w-full h-full object-contain" muted />
                            ) : (
                              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="truncate text-xs">
                            <p className="font-semibold text-slate-200 truncate">{selectedFile?.name}</p>
                            <p className="text-slate-400 text-[11px]">
                              {selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : 0} MB •{' '}
                              <span className="text-blue-400 uppercase font-semibold">
                                {selectedFile?.type.startsWith('video/') ? 'Video' : 'Imagen'}
                              </span>
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setPreviewUrl(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-xs text-slate-400 hover:text-rose-400 px-2.5 py-1 rounded hover:bg-slate-800 transition cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* Barra de progreso */}
                    {isUploading && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>Transmitiendo al servidor...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-blue-500 h-2 transition-all duration-200 rounded-full"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={!selectedFile || isUploading}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition shadow-md shadow-blue-600/20 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {isUploading ? `Transmitiendo (${uploadProgress}%)...` : 'Transmitir Archivo a los Televisores'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Card: Biblioteca Multimedia con Bucle Infinito */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Film className="w-5 h-5 text-blue-400" />
                      Biblioteca Multimedia ({galleryFiles.length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Arrastra cualquier video o imagen desde aquí hacia los días o lista de reproducción del <strong>lado derecho →</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      fetchGallery();
                      fetchPlaylistStatus();
                      fetchSchedule();
                      fetchMediaMeta();
                    }}
                    className="text-xs text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                    title="Actualizar biblioteca"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Actualizar
                  </button>
                </div>

                {/* Panel de Control del Bucle Infinito */}
                <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/90 to-blue-950/40 border border-emerald-500/30 rounded-xl p-3.5 shadow-lg backdrop-blur-sm space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg ${playlist.enabled ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40' : 'bg-slate-800 text-slate-400'}`}>
                        <Repeat className={`w-5 h-5 ${playlist.enabled ? 'animate-spin' : ''}`} style={{ animationDuration: '8s' }} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white tracking-wide">
                            Bucle Infinito
                          </h4>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                            playlist.enabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/20 animate-pulse'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}>
                            {playlist.enabled ? '● ACTIVO' : 'PAUSADO'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300">
                          {useWeeklySchedule ? (
                            <span>
                              Bucle de hoy:{' '}
                              <strong className="text-emerald-400 uppercase">
                                {DAYS_META.find((d) => d.key === currentDayKey)?.label || currentDayKey}
                              </strong>{' '}
                              ({weeklySchedule[currentDayKey]?.items?.length || 0} archivos)
                            </span>
                          ) : (
                            <span>Toda la biblioteca ({galleryFiles.length} archivos)</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Botón Activar / Pausar Bucle */}
                    <button
                      type="button"
                      onClick={handleTogglePlaylist}
                      disabled={galleryFiles.length === 0}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                        playlist.enabled
                          ? 'bg-amber-600/90 hover:bg-amber-500 text-white shadow-amber-600/20 border border-amber-500/30'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 border border-emerald-400/40'
                      }`}
                    >
                      {playlist.enabled ? (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-white" /> Pausar
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-white" /> Iniciar Bucle
                        </>
                      )}
                    </button>
                  </div>

                  {/* Controles de navegación y duración */}
                  <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handlePlaylistPrev}
                        disabled={galleryFiles.length <= 1}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        title="Medio anterior"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handlePlaylistNext}
                        disabled={galleryFiles.length <= 1}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        title="Medio siguiente"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={handleToggleShuffle}
                        className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition border cursor-pointer ${
                          playlist.shuffle
                            ? 'bg-purple-950/80 border-purple-500/50 text-purple-300'
                            : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                        title="Cambiar entre reproducción ordenada o aleatoria"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        {playlist.shuffle ? 'Aleatorio' : 'Secuencial'}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[11px]">Duración imagen:</span>
                      <div className="flex items-center gap-0.5 bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
                        {[5, 8, 10, 15, 20, 30].map((sec) => (
                          <button
                            type="button"
                            key={sec}
                            onClick={() => handleSetInterval(sec)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
                              playlist.intervalSeconds === sec
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Indicador del medio activo */}
                  {currentMedia && currentMedia.url && currentMedia.type !== 'clear' && (
                    <div className="bg-slate-950/90 border border-slate-800/90 rounded-lg px-3 py-1.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping flex-shrink-0"></span>
                        <span className="text-slate-400 text-[11px]">En pantalla:</span>
                        <span className="text-white font-semibold truncate max-w-[160px]">{currentMedia.fileName}</span>
                        <span className="text-[9px] uppercase font-bold text-blue-400 px-1 py-0.5 bg-blue-500/10 rounded border border-blue-500/20 flex-shrink-0">
                          {currentMedia.type}
                        </span>
                      </div>
                      {typeof playlist.currentIndex === 'number' && playlist.totalItems > 0 && (
                        <span className="text-[11px] font-bold text-emerald-400 flex-shrink-0">
                          {playlist.currentIndex + 1} de {playlist.totalItems}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Galería de Tarjetas de Archivos para Arrastrar */}
                {galleryFiles.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/30 flex flex-col items-center justify-center gap-2">
                    <Film className="w-8 h-8 text-slate-600" />
                    <span>Aún no tienes archivos guardados en la biblioteca.</span>
                    <span className="text-[11px] text-slate-600">Sube una imagen o video arriba para comenzar a organizarlos por días.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[580px] overflow-y-auto pr-1">
                    {galleryFiles.map((file, idx) => {
                      const isCurrentActive = currentMedia && currentMedia.fileName === file.fileName;
                      const isAssignedToSelectedDay = weeklySchedule[selectedScheduleDay]?.items?.includes(file.fileName);
                      const isBeingDragged = draggedFile === file.fileName;

                      return (
                        <div
                          key={`${file.fileName}-${idx}`}
                          draggable={true}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', file.fileName);
                            e.dataTransfer.setData('fileName', file.fileName);
                            e.dataTransfer.setData('mediaType', file.type);
                            setDraggedFile(file.fileName);
                          }}
                          onDragEnd={() => {
                            setDraggedFile(null);
                            setDragOverDay(null);
                            setIsDayDropZoneActive(false);
                          }}
                          className={`group relative p-2.5 rounded-xl transition flex flex-col gap-2 cursor-grab active:cursor-grabbing select-none ${
                            isBeingDragged
                              ? 'opacity-40 border-2 border-dashed border-blue-400 scale-95 ring-2 ring-blue-500'
                              : isCurrentActive
                              ? 'bg-slate-900/90 border-2 border-emerald-500 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-500/50'
                              : 'bg-slate-900 border border-slate-800 hover:border-blue-500 hover:shadow-md'
                          }`}
                        >
                          {/* Miniatura del archivo */}
                          <div className="w-full h-28 bg-black rounded-lg overflow-hidden flex items-center justify-center relative">
                            {file.type === 'video' ? (
                              <video src={file.url} className="w-full h-full object-cover" muted />
                            ) : (
                              <img src={file.url} alt={file.fileName} className="w-full h-full object-cover" />
                            )}

                            {/* Marca de agua arriba a la derecha en la miniatura */}
                            {watermarkConfig.enabled && (
                              <div className="absolute top-1.5 right-1.5 z-20 pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
                                {watermarkConfig.logoUrl ? (
                                  <img
                                    src={watermarkConfig.logoUrl}
                                    alt="Logo"
                                    className="max-h-5 max-w-[55px] object-contain"
                                  />
                                ) : (
                                  <Tv className="w-4 h-4 text-white/80" />
                                )}
                              </div>
                            )}

                            {/* Botón flotante para proyectar */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 z-10">
                              <button
                                type="button"
                                onClick={() => handlePlayFromItem(idx)}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow cursor-pointer"
                                title="Transmitir de inmediato"
                              >
                                <Play className="w-3 h-3 fill-white" /> Proyectar
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleDeleteGalleryItem(e, file.fileName)}
                              className="absolute bottom-1 right-1 p-1 bg-black/70 hover:bg-rose-600 text-slate-300 hover:text-white rounded opacity-0 group-hover:opacity-100 transition z-20 cursor-pointer"
                              title="Eliminar archivo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Icono de arrastre */}
                            <div className="absolute top-1.5 left-1.5 p-1 bg-black/60 rounded text-slate-400 group-hover:text-blue-400 transition" title="Arrastra este archivo hacia el panel derecho">
                              <GripVertical className="w-3 h-3" />
                            </div>
                          </div>

                          {/* Info y Botones de asignación */}
                          <div className="flex flex-col gap-1.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className={`truncate font-medium text-[11px] ${isCurrentActive ? 'text-emerald-300 font-bold' : 'text-slate-200'}`} title={file.fileName}>
                                {file.fileName}
                              </span>
                              <span className={`text-[9px] font-bold uppercase ml-1 flex-shrink-0 ${isCurrentActive ? 'text-emerald-400' : 'text-blue-400'}`}>
                                {file.type}
                              </span>
                            </div>

                            {/* Botones de asignación a días */}
                            <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isAssignedToSelectedDay) {
                                    handleRemoveFileFromDay(selectedScheduleDay, file.fileName);
                                  } else {
                                    handleAddFileToDay(selectedScheduleDay, file.fileName);
                                  }
                                }}
                                className={`flex-1 py-1 px-1.5 rounded text-[10px] font-semibold transition cursor-pointer flex items-center justify-center gap-1 ${
                                  isAssignedToSelectedDay
                                    ? 'bg-emerald-950/80 border border-emerald-600 text-emerald-300'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                                }`}
                              >
                                <Plus className="w-3 h-3" />
                                {isAssignedToSelectedDay
                                  ? `En ${DAYS_META.find((d) => d.key === selectedScheduleDay)?.short || selectedScheduleDay}`
                                  : `Añadir a ${DAYS_META.find((d) => d.key === selectedScheduleDay)?.short || selectedScheduleDay}`}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAddFileToAllDays(file.fileName)}
                                className="py-1 px-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white text-[10px] font-semibold transition cursor-pointer"
                                title="Agregar a todos los días de la semana"
                              >
                                Todos
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ==================== LADO DERECHO: ASIGNACIÓN DE DÍAS Y SIMULADOR ==================== */}
            <div className="lg:col-span-6 flex flex-col gap-6">

              {/* Card: ASIGNACIÓN DE DÍAS (Programación Semanal por Día) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4 animate-fade-in">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-400" />
                        Asignación de Días (Lunes a Domingo)
                      </h3>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase">
                        Programación
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Día actual (hoy:{' '}
                      <strong className="text-emerald-400 font-bold uppercase">
                        {DAYS_META.find((d) => d.key === currentDayKey)?.label || currentDayKey}
                      </strong>
                      ). Suelta videos directamente sobre cualquier día o en la zona de soltado.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleWeeklyMode}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer border ${
                        useWeeklySchedule
                          ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${useWeeklySchedule ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
                      {useWeeklySchedule ? 'Filtro por Día: ACTIVO' : 'Filtro por Día: DESACTIVADO'}
                    </button>
                  </div>
                </div>

                {/* Banner animado cuando se arrastra un archivo */}
                {draggedFile && (
                  <div className="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-500/60 text-emerald-200 text-xs flex items-center justify-between animate-pulse">
                    <span className="flex items-center gap-2 truncate">
                      <GripVertical className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <span className="truncate">Arrastrando: <strong>{draggedFile}</strong></span>
                    </span>
                    <span className="text-[11px] font-bold uppercase text-emerald-300 flex-shrink-0 ml-2">
                      ¡Suelta sobre cualquier día!
                    </span>
                  </div>
                )}

                {/* Selector de Días de la Semana con soporte de Arrastrar y Soltar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <span className="flex items-center gap-1.5">
                      <GripVertical className="w-3 h-3 text-blue-400" />
                      <span>Selecciona un día o <strong>suelta videos sobre cualquier botón</strong>:</span>
                    </span>
                    {dragOverDay && (
                      <span className="text-emerald-400 font-bold animate-pulse">
                        ¡Soltar en {DAYS_META.find((d) => d.key === dragOverDay)?.label}!
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {DAYS_META.map((day) => {
                      const isToday = currentDayKey === day.key;
                      const isSelected = selectedScheduleDay === day.key;
                      const isHovered = dragOverDay === day.key;
                      const itemCount = weeklySchedule[day.key]?.items?.length || 0;
                      return (
                        <button
                          key={day.key}
                          type="button"
                          onClick={() => setSelectedScheduleDay(day.key)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                            if (dragOverDay !== day.key) setDragOverDay(day.key);
                          }}
                          onDragLeave={() => {
                            if (dragOverDay === day.key) setDragOverDay(null);
                          }}
                          onDrop={(e) => handleDropOnDay(day.key, e)}
                          className={`p-2 rounded-xl border flex flex-col items-center justify-center transition cursor-pointer relative ${
                            isHovered
                              ? 'bg-emerald-600/90 border-emerald-400 text-white shadow-xl shadow-emerald-500/40 scale-105 ring-2 ring-emerald-400 animate-pulse'
                              : isSelected
                              ? 'bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-600/30 scale-[1.02]'
                              : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                          }`}
                        >
                          {isHovered ? (
                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase px-1.5 py-0.2 rounded-full shadow bg-emerald-400 text-slate-950 whitespace-nowrap">
                              ¡SOLTAR!
                            </span>
                          ) : isToday ? (
                            <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase px-1.5 py-0.2 rounded-full shadow ${
                              isSelected ? 'bg-emerald-400 text-slate-950' : 'bg-emerald-500 text-white animate-pulse'
                            }`}>
                              HOY
                            </span>
                          ) : null}
                          <span className="text-xs font-bold">{day.short}</span>
                          <span className="text-[10px] hidden sm:inline opacity-80">{day.label}</span>
                          <span className={`text-[10px] mt-1 font-mono font-semibold px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-950 text-blue-400 border border-slate-800'
                          }`}>
                            {itemCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Panel de Configuración del Día Seleccionado */}
                {(() => {
                  const dayConfig = weeklySchedule[selectedScheduleDay] || { enabled: true, intervalSeconds: 10, items: [] };
                  const dayMeta = DAYS_META.find((d) => d.key === selectedScheduleDay);
                  const isSelectedToday = selectedScheduleDay === currentDayKey;

                  return (
                    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-sm">
                            {dayMeta?.short}
                          </span>
                          <div>
                            <h4 className="text-xs font-bold text-white flex items-center gap-2">
                              Bucle para: {dayMeta?.label}
                              {isSelectedToday && (
                                <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded-full font-bold">
                                  En Vivo Ahora
                                </span>
                              )}
                            </h4>
                            <p className="text-[10px] text-slate-400">
                              {dayConfig.items.length === 0
                                ? `Sin archivos para ${dayMeta?.label}. Arrastra aquí desde la izquierda.`
                                : `${dayConfig.items.length} elemento(s) en bucle este día.`}
                            </p>
                          </div>
                        </div>

                        {/* Duración de imágenes para este día */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <Clock className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-[11px]">Duración imagen:</span>
                          <select
                            value={dayConfig.intervalSeconds || 10}
                            onChange={(e) => handleUpdateDaySchedule(selectedScheduleDay, dayConfig.items, Number(e.target.value))}
                            className="bg-slate-950 border border-slate-700 text-white rounded-lg px-2 py-0.5 text-xs focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="5">5 seg</option>
                            <option value="8">8 seg</option>
                            <option value="10">10 seg</option>
                            <option value="15">15 seg</option>
                            <option value="20">20 seg</option>
                            <option value="30">30 seg</option>
                            <option value="60">1 min</option>
                          </select>
                        </div>
                      </div>

                      {/* ZONA DE ARRASTRE Y SOLTADO ACTIVA PARA EL DÍA */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'copy';
                          setIsDayDropZoneActive(true);
                        }}
                        onDragLeave={() => setIsDayDropZoneActive(false)}
                        onDrop={(e) => handleDropOnDay(selectedScheduleDay, e)}
                        className={`p-3.5 rounded-xl border-2 border-dashed transition-all flex items-center justify-center gap-3 text-center cursor-pointer ${
                          isDayDropZoneActive
                            ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200 scale-[1.01] shadow-lg shadow-emerald-500/20'
                            : 'bg-slate-950/70 border-slate-700/80 hover:border-blue-500/80 hover:bg-slate-900/60 text-slate-400'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isDayDropZoneActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-600/10 text-blue-400'
                        }`}>
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <div className="text-xs font-bold text-slate-200">
                            {isDayDropZoneActive
                              ? `¡Suelta aquí para agregar a la lista de ${dayMeta?.label}!`
                              : `Arrastra videos o imágenes aquí para agregarlos a ${dayMeta?.label}`}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Arrastra desde la Biblioteca de la izquierda o suelta archivos desde tu computadora
                          </div>
                        </div>
                      </div>

                      {/* Lista ordenada del día */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-blue-400" />
                            Orden de Reproducción ({dayMeta?.label}):
                          </span>
                          <div className="flex items-center gap-2">
                            {dayConfig.items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleUpdateDaySchedule(selectedScheduleDay, [])}
                                className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                              >
                                Vaciar este día
                              </button>
                            )}
                          </div>
                        </div>

                        {dayConfig.items.length === 0 ? (
                          <div className="p-5 border-2 border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500 bg-slate-950/40">
                            <p className="font-medium text-slate-400 mb-1">
                              Este día aún no tiene videos programados
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Arrastra videos desde la biblioteca de la izquierda o presiona <strong className="text-blue-400">+ Añadir a {dayMeta?.short}</strong>.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {dayConfig.items.map((fileName, idx) => {
                              const file = galleryFiles.find((f) => f.fileName === fileName) || {
                                fileName,
                                url: `/uploads/${fileName}`,
                                type: fileName.match(/\.(mp4|webm|ogg|mov)$/i) ? 'video' : 'image',
                              };
                              const isCurrentPlaying = currentMedia?.fileName === fileName && isSelectedToday;
                              const isBeingDraggedOver = dragOverItemIndex === idx;

                              return (
                                <div
                                  key={`${fileName}-${idx}`}
                                  draggable={true}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData('reorderIndex', String(idx));
                                    e.dataTransfer.setData('text/plain', fileName);
                                  }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (dragOverItemIndex !== idx) setDragOverItemIndex(idx);
                                  }}
                                  onDragLeave={() => {
                                    if (dragOverItemIndex === idx) setDragOverItemIndex(null);
                                  }}
                                  onDrop={(e) => handleDropReorder(selectedScheduleDay, idx, e)}
                                  className={`p-2 rounded-xl border flex items-center justify-between gap-2.5 transition cursor-grab active:cursor-grabbing select-none ${
                                    isBeingDraggedOver
                                      ? 'bg-blue-950/80 border-blue-400 ring-2 ring-blue-400 scale-[1.01]'
                                      : isCurrentPlaying
                                      ? 'bg-slate-900 border-emerald-500/80 shadow-md shadow-emerald-500/10'
                                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 overflow-hidden">
                                    <div className="flex items-center gap-1 flex-shrink-0 text-slate-500 hover:text-slate-300">
                                      <GripVertical className="w-3.5 h-3.5 cursor-grab" />
                                      <span className="w-5 h-5 rounded-full bg-slate-900 text-slate-400 border border-slate-800 flex items-center justify-center text-[10px] font-mono font-bold">
                                        {idx + 1}
                                      </span>
                                    </div>
                                    <div className="w-10 h-8 bg-black rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center border border-slate-800">
                                      {file.type === 'video' ? (
                                        <video src={file.url} className="w-full h-full object-cover" muted />
                                      ) : (
                                        <img src={file.url} alt={file.fileName} className="w-full h-full object-cover" />
                                      )}
                                    </div>
                                    <div className="truncate text-xs">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-slate-200 font-semibold truncate max-w-[150px] sm:max-w-xs">
                                          {fileName}
                                        </span>
                                        <span className="text-[9px] uppercase font-bold px-1 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-800">
                                          {file.type}
                                        </span>
                                        {isCurrentPlaying && (
                                          <span className="text-[8px] bg-emerald-500 text-slate-950 px-1 py-0.2 rounded font-black animate-pulse">
                                            EN VIVO
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleMoveDayItem(selectedScheduleDay, idx, idx - 1)}
                                      disabled={idx === 0}
                                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs cursor-pointer"
                                      title="Subir de posición"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveDayItem(selectedScheduleDay, idx, idx + 1)}
                                      disabled={idx === dayConfig.items.length - 1}
                                      className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs cursor-pointer"
                                      title="Bajar de posición"
                                    >
                                      ▼
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFileFromDay(selectedScheduleDay, fileName)}
                                      className="p-1 rounded bg-slate-900 hover:bg-rose-950 hover:text-rose-300 text-slate-400 transition cursor-pointer"
                                      title="Quitar de este día"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Card: SIMULADOR DE TV EN VIVO (Ubicado en el lado derecho para monitorear en tiempo real) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Eye className="w-4 h-4 text-emerald-400" />
                      Simulador de TV en Vivo
                    </h2>
                    <p className="text-[11px] text-slate-400">Vista sincronizada en tiempo real con las pantallas</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClearScreen}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 rounded text-xs flex items-center gap-1.5 transition border border-slate-700 cursor-pointer"
                      title="Poner en modo espera"
                    >
                      <Power className="w-3.5 h-3.5" />
                      Modo Espera
                    </button>
                  </div>
                </div>

                {/* Pantalla Simulada del TV con marco */}
                <div className="p-3.5 flex flex-col items-center justify-center">
                  <div className="w-full aspect-video bg-black rounded-lg border-4 border-slate-800 relative overflow-hidden flex items-center justify-center shadow-2xl">
                    {currentMedia && currentMedia.url && currentMedia.type !== 'clear' ? (
                      <>
                        {currentMedia.type === 'video' ? (
                          <video
                            key={currentMedia.url}
                            src={currentMedia.url}
                            autoPlay
                            loop={!playlist.enabled}
                            onEnded={handlePlaylistNext}
                            muted
                            playsInline
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <img
                            key={currentMedia.url}
                            src={currentMedia.url}
                            alt={currentMedia.fileName}
                            className="w-full h-full object-contain"
                          />
                        )}

                        {/* Marca de agua fija ARRIBA A LA DERECHA en el simulador (100% nítida, sin fondo ni recuadros) */}
                        {(() => {
                          const wm = currentMedia.watermark || watermarkConfig;
                          const isVideo = currentMedia.type === 'video';
                          const show = wm && wm.enabled && (!wm.applyToVideosOnly || isVideo);
                          if (!show) return null;
                          return (
                            <div className="absolute top-3 right-3 z-30 pointer-events-none transition-all">
                              {wm.logoUrl ? (
                                <img
                                  src={wm.logoUrl}
                                  alt="Logo"
                                  className="max-h-9 max-w-[110px] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                                />
                              ) : (
                                <div className="text-white/80 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                                  <Tv className="w-5 h-5 text-white" />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-4 text-slate-600 gap-2">
                        <div className="w-3.5 h-3.5 rounded-full bg-blue-500/80 animate-pulse" />
                        <span className="text-xs font-bold text-slate-400 tracking-wider">MODO ESPERA</span>
                        <span className="text-[11px] text-slate-600 max-w-xs">
                          No hay contenido transmitiéndose. Transmite un archivo o activa el bucle.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Información del contenido proyectado */}
                  <div className="w-full mt-2.5 p-2.5 bg-slate-900/80 border border-slate-800/80 rounded-lg text-xs flex items-center justify-between">
                    <div className="truncate mr-2">
                      <span className="text-slate-400">Transmitiendo:</span>{' '}
                      <span className="font-semibold text-white truncate">
                        {currentMedia?.fileName || 'Ninguno (Modo Espera)'}
                      </span>
                    </div>
                    <div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-300">
                        {currentMedia?.type || 'Espera'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* =========================================================================
             VISTA PESTAÑA 2: CONFIGURACIÓN DE MARCA DE AGUA Y LOGO
             (Sin opacidad ni selector de ubicación en pantalla)
             ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 flex flex-col gap-6">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-sm space-y-5 animate-fade-in">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Tv className="w-5 h-5 text-blue-400" />
                    Configuración de Marca de Agua (Logotipo Transparente)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    El logotipo transparente (PNG sin fondo) se proyecta fijamente en la esquina <strong className="text-emerald-400">arriba a la derecha</strong> sobre la transmisión, con nitidez total y sin recuadros de fondo.
                  </p>
                </div>

                {/* Interruptor de activación y ámbito de visualización */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
                    <div>
                      <div className="text-xs font-bold text-white">Marca de Agua en Pantalla</div>
                      <div className="text-[11px] text-slate-400">Proyectar logotipo en la transmisión</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSaveWatermark({ enabled: !watermarkConfig.enabled })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                        watermarkConfig.enabled
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                          : 'bg-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {watermarkConfig.enabled ? '✓ Activada' : 'Desactivada'}
                    </button>
                  </div>

                  <div className="space-y-1.5 p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
                    <span className="text-xs font-bold text-slate-200 block">Ámbito de visualización</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveWatermark({ applyToVideosOnly: true })}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          watermarkConfig.applyToVideosOnly
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        Solo en Videos
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveWatermark({ applyToVideosOnly: false })}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                          !watermarkConfig.applyToVideosOnly
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        Videos e Imágenes
                      </button>
                    </div>
                  </div>
                </div>

                {/* Subida de Logo Transparente */}
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-xs font-bold text-slate-200 block">Imagen del Logotipo</label>
                      <span className="text-[11px] text-slate-400">Sube una imagen PNG transparente o sin fondo para que flote limpiamente sobre los videos</span>
                    </div>
                    {watermarkConfig.logoUrl && (
                      <button
                        type="button"
                        onClick={() => handleSaveWatermark({ logoUrl: '' })}
                        className="text-xs text-rose-400 hover:underline cursor-pointer"
                      >
                        Quitar Logo
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-24 h-20 bg-slate-950 rounded-lg border border-slate-700 flex items-center justify-center p-2 overflow-hidden flex-shrink-0 relative">
                      {/* Cuadrícula de transparencia */}
                      <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:8px_8px]"></div>
                      {watermarkConfig.logoUrl ? (
                        <img src={watermarkConfig.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain relative z-10 drop-shadow-md" />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 relative z-10">
                          <Tv className="w-5 h-5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleUploadLogo}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={isUploadingLogo}
                        onClick={() => logoInputRef.current?.click()}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-sm"
                      >
                        <Upload className="w-4 h-4" />
                        {isUploadingLogo ? 'Subiendo logo...' : 'Seleccionar Imagen PNG sin fondo'}
                      </button>
                      <p className="text-[11px] text-slate-400">
                        Ubicación fija: <strong>Arriba a la derecha</strong> en la pantalla del televisor.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Vista previa en vivo de la marca de agua */}
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                      Vista Previa (Fija Arriba a la Derecha)
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Sin recuadro ni etiqueta • Solo imagen transparente
                    </span>
                  </div>
                  <div className="w-full h-32 bg-gradient-to-tr from-slate-900 via-indigo-950/40 to-slate-900 rounded-lg border border-slate-800 relative flex items-center justify-center overflow-hidden">
                    <span className="text-xs text-slate-600 font-mono select-none">Transmisión de TV</span>
                    <div className="absolute top-3 right-3 pointer-events-none transition-all">
                      {watermarkConfig.logoUrl ? (
                        <img
                          src={watermarkConfig.logoUrl}
                          alt="Logo"
                          className="max-h-12 max-w-[150px] object-contain drop-shadow-[0_3px_10px_rgba(0,0,0,0.85)]"
                        />
                      ) : (
                        <div className="text-white/80 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
                          <Tv className="w-8 h-8 text-white" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Simulador TV en la pestaña de Marca de Agua */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div className="p-3.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2 text-white">
                      <Eye className="w-4 h-4 text-emerald-400" />
                      Simulador de TV en Vivo
                    </h2>
                    <p className="text-[11px] text-slate-400">Vista previa del logotipo sobre la pantalla del TV</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleClearScreen}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 rounded text-xs flex items-center gap-1.5 transition border border-slate-700 cursor-pointer"
                      title="Poner en modo espera"
                    >
                      <Power className="w-3.5 h-3.5" />
                      Modo Espera
                    </button>
                  </div>
                </div>

                <div className="p-4 flex flex-col items-center justify-center">
                  <div className="w-full aspect-video bg-black rounded-lg border-4 border-slate-800 relative overflow-hidden flex items-center justify-center shadow-2xl">
                    {currentMedia && currentMedia.url && currentMedia.type !== 'clear' ? (
                      <>
                        {currentMedia.type === 'video' ? (
                          <video
                            key={currentMedia.url}
                            src={currentMedia.url}
                            autoPlay
                            loop={!playlist.enabled}
                            onEnded={handlePlaylistNext}
                            muted
                            playsInline
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <img
                            key={currentMedia.url}
                            src={currentMedia.url}
                            alt={currentMedia.fileName}
                            className="w-full h-full object-contain"
                          />
                        )}

                        {watermarkConfig.enabled && (
                          <div className="absolute top-3 right-3 z-30 pointer-events-none transition-all">
                            {watermarkConfig.logoUrl ? (
                              <img
                                src={watermarkConfig.logoUrl}
                                alt="Logo"
                                className="max-h-9 max-w-[110px] object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]"
                              />
                            ) : (
                              <div className="text-white/80 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                                <Tv className="w-5 h-5 text-white" />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-4 text-slate-600 gap-2">
                        <div className="w-3.5 h-3.5 rounded-full bg-blue-500/80 animate-pulse" />
                        <span className="text-xs font-bold text-slate-400 tracking-wider">MODO ESPERA</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal QR para Smart TV */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 animate-fade-in backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 max-w-md w-full text-center relative shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1 flex items-center justify-center gap-2">
              <QrCode className="w-5 h-5 text-blue-400" />
              Conectar Pantalla Smart TV
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Escanea el código con la cámara de tu teléfono móvil o el navegador del Smart TV:
            </p>

            {/* Código QR con la URL activa */}
            {(() => {
              const currentDisplayUrl = shortTvUrl || currentTvUrl;
              return (
                <>
                  <div className="bg-white p-3 rounded-xl inline-block mx-auto mb-3 shadow-lg">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(currentDisplayUrl)}`}
                      alt="QR Smart TV"
                      className="w-48 h-48 block"
                    />
                  </div>

                  <div className="text-xs text-emerald-400 font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-800 mb-3 break-all select-all text-center font-bold">
                    {currentDisplayUrl}
                  </div>

                  <div className="text-[11px] text-emerald-300/90 bg-emerald-950/40 border border-emerald-800/40 p-2.5 rounded-lg mb-4 text-left">
                    ✓ <strong>Acceso Directo:</strong> Este enlace abre directamente la pantalla de visualización sin pedir contraseñas ni cuenta de Google en el televisor.
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyText(currentDisplayUrl, 'Enlace de TV')}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copiar Enlace
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQrModal(false)}
                      className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      Cerrar
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
