(function () {
if (window.DueListDB) {
  return;
}

const DB_NAME = "duelist-db";
const DB_VERSION = 4;
const TASK_STORE = "tasks";
const META_STORE = "meta";
const SUBJECT_STORE = "subjects";
const QUICK_NOTE_STORE = "quickNotes";
const DEMO_SEED_KEY = "demoSeeded";
const THEME_KEY = "theme";
const BACKUP_SCHEMA_VERSION = 1;

const DEFAULT_SUBJECT_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#ca8a04",
  "#db2777",
  "#475569",
  "#0f766e"
];

let databasePromise = null;

function initDB() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB n'est pas disponible dans ce navigateur."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;

      let taskStore;
      if (!db.objectStoreNames.contains(TASK_STORE)) {
        taskStore = db.createObjectStore(TASK_STORE, { keyPath: "id" });
      } else {
        taskStore = transaction.objectStore(TASK_STORE);
      }

      ensureIndex(taskStore, "dueDate", "dueDate");
      ensureIndex(taskStore, "completed", "completed");
      ensureIndex(taskStore, "archived", "archived");
      ensureIndex(taskStore, "archiveReason", "archiveReason");
      ensureIndex(taskStore, "isEvaluation", "isEvaluation");
      ensureIndex(taskStore, "createdAt", "createdAt");

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }

      let subjectStore;
      if (!db.objectStoreNames.contains(SUBJECT_STORE)) {
        subjectStore = db.createObjectStore(SUBJECT_STORE, { keyPath: "id" });
      } else {
        subjectStore = transaction.objectStore(SUBJECT_STORE);
      }

      ensureIndex(subjectStore, "name", "name");

      let quickNoteStore;
      if (!db.objectStoreNames.contains(QUICK_NOTE_STORE)) {
        quickNoteStore = db.createObjectStore(QUICK_NOTE_STORE, { keyPath: "id" });
      } else {
        quickNoteStore = transaction.objectStore(QUICK_NOTE_STORE);
      }

      ensureIndex(quickNoteStore, "createdAt", "createdAt");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function ensureIndex(store, name, keyPath, options = { unique: false }) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

async function getAllTasks(options = {}) {
  const tasks = await runRequest(TASK_STORE, "readonly", (store) => store.getAll());
  const normalizedTasks = [...(tasks || [])].map(normalizeTask);

  if (options.includeArchived) {
    return normalizedTasks.sort(compareTasks);
  }

  return normalizedTasks.filter(isActiveTask).sort(compareTasks);
}

async function getArchivedTasks() {
  const tasks = await getAllTasks({ includeArchived: true });
  return tasks
    .filter((task) => task.archived)
    .sort((firstTask, secondTask) => {
      return (secondTask.archivedAt || "").localeCompare(firstTask.archivedAt || "");
    });
}

async function addTask(task) {
  const now = new Date().toISOString();
  const savedTask = normalizeTask({
    ...task,
    id: task.id || createId("task"),
    completed: Boolean(task.completed),
    archived: Boolean(task.archived),
    createdAt: task.createdAt || now,
    updatedAt: now
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.add(savedTask));
  await addSubject(savedTask.subject);
  return savedTask;
}

async function updateTask(task) {
  const savedTask = normalizeTask({
    ...task,
    updatedAt: new Date().toISOString()
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.put(savedTask));
  await addSubject(savedTask.subject);
  return savedTask;
}

async function deleteTask(id) {
  return archiveTask(id, "deleted");
}

async function permanentlyDeleteTask(id) {
  await runRequest(TASK_STORE, "readwrite", (store) => store.delete(id));
}

async function markTaskCompleted(id) {
  return archiveTask(id, "completed");
}

async function archiveTask(id, reason) {
  const task = await getTaskById(id);

  if (!task) {
    return null;
  }

  const now = new Date().toISOString();
  const normalizedReason = reason === "completed" ? "completed" : "deleted";
  const updatedTask = normalizeTask({
    ...task,
    completed: normalizedReason === "completed" ? true : Boolean(task.completed),
    completedAt: normalizedReason === "completed" ? task.completedAt || now : task.completedAt || "",
    archived: true,
    archiveReason: normalizedReason,
    archivedAt: now,
    deletedAt: normalizedReason === "deleted" ? now : task.deletedAt || "",
    updatedAt: now
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.put(updatedTask));
  return updatedTask;
}

async function restoreTask(id) {
  const task = await getTaskById(id);

  if (!task) {
    return null;
  }

  const restoredTask = normalizeTask({
    ...task,
    completed: false,
    completedAt: "",
    archived: false,
    archiveReason: "",
    archivedAt: "",
    deletedAt: "",
    updatedAt: new Date().toISOString()
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.put(restoredTask));
  await addSubject(restoredTask.subject);
  return restoredTask;
}

async function resetAppData() {
  await clearStore(TASK_STORE);
  await clearStore(META_STORE);
  await clearStore(SUBJECT_STORE);
  await clearStore(QUICK_NOTE_STORE);
  await setMeta(DEMO_SEED_KEY, true);
}

async function getQuickNotes() {
  const notes = await runRequest(QUICK_NOTE_STORE, "readonly", (store) => store.getAll());
  return [...(notes || [])].map(normalizeQuickNote).sort((firstNote, secondNote) => {
    return secondNote.createdAt.localeCompare(firstNote.createdAt);
  });
}

async function addQuickNote(content) {
  const cleanContent = String(content || "").trim();

  if (!cleanContent) {
    return null;
  }

  const now = new Date().toISOString();
  const note = {
    id: createId("note"),
    content: cleanContent,
    createdAt: now,
    updatedAt: now
  };

  await runRequest(QUICK_NOTE_STORE, "readwrite", (store) => store.add(note));
  return note;
}

async function deleteQuickNote(id) {
  await runRequest(QUICK_NOTE_STORE, "readwrite", (store) => store.delete(id));
}

async function getAppTheme() {
  return (await getMeta(THEME_KEY)) || "light";
}

async function setAppTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  await setMeta(THEME_KEY, nextTheme);
  return nextTheme;
}

async function getSubjects() {
  const subjects = await getSubjectRecords();
  return subjects.map((subject) => subject.name);
}

async function getSubjectRecords() {
  const subjects = await runRequest(SUBJECT_STORE, "readonly", (store) => store.getAll());
  return [...(subjects || [])]
    .map(normalizeSubject)
    .filter((subject) => subject.name)
    .sort((firstSubject, secondSubject) => firstSubject.name.localeCompare(secondSubject.name, "fr"));
}

async function addSubject(name, color) {
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    return null;
  }

  const id = normalizeSubjectId(cleanName);
  const currentSubject = await getSubjectById(id);
  const now = new Date().toISOString();
  const subject = normalizeSubject({
    ...currentSubject,
    id,
    name: cleanName,
    color: color || currentSubject?.color || getDefaultSubjectColor(cleanName),
    createdAt: currentSubject?.createdAt || now,
    updatedAt: now
  });

  await runRequest(SUBJECT_STORE, "readwrite", (store) => store.put(subject));
  return subject;
}

async function updateSubjectColor(name, color) {
  const cleanName = String(name || "").trim();
  const cleanColor = normalizeColor(color);

  if (!cleanName || !cleanColor) {
    throw new Error("La matière ou la couleur est invalide.");
  }

  return addSubject(cleanName, cleanColor);
}

async function getSubjectById(id) {
  if (!id) {
    return null;
  }

  return runRequest(SUBJECT_STORE, "readonly", (store) => store.get(id));
}

async function getTasksByDate(date) {
  const tasks = await getAllTasks();
  return tasks.filter((task) => task.dueDate === date);
}

async function getUpcomingTasks() {
  const today = getLocalISODate(new Date());
  const limit = getLocalISODate(addDays(new Date(), 14));
  const tasks = await getAllTasks();

  return tasks.filter((task) => {
    return task.dueDate > today && task.dueDate <= limit;
  });
}

async function getTodayTasks() {
  return getTasksByDate(getLocalISODate(new Date()));
}

async function getWeekTasks() {
  const today = getLocalISODate(new Date());
  const limit = getLocalISODate(addDays(new Date(), 7));
  const tasks = await getAllTasks();

  return tasks.filter((task) => {
    return task.dueDate >= today && task.dueDate <= limit;
  });
}

async function getImportantEvaluations() {
  const today = getLocalISODate(new Date());
  const limit = getLocalISODate(addDays(new Date(), 30));
  const tasks = await getAllTasks();

  return tasks
    .filter((task) => {
      return task.isEvaluation && task.dueDate >= today && task.dueDate <= limit;
    })
    .slice(0, 5);
}

async function getTaskById(id) {
  const task = await runRequest(TASK_STORE, "readonly", (store) => store.get(id));
  return task ? normalizeTask(task) : null;
}

async function exportAppData() {
  const [tasks, subjects, quickNotes, theme] = await Promise.all([
    getAllTasks({ includeArchived: true }),
    getSubjectRecords(),
    getQuickNotes(),
    getAppTheme()
  ]);

  return {
    app: "DueList",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      theme
    },
    subjects,
    tasks,
    quickNotes
  };
}

async function importAppData(payload, mode = "merge") {
  const normalizedMode = mode === "replace" ? "replace" : "merge";
  const data = normalizeImportPayload(payload);

  if (normalizedMode === "replace") {
    await clearStore(TASK_STORE);
    await clearStore(SUBJECT_STORE);
    await clearStore(QUICK_NOTE_STORE);
    await setMeta(DEMO_SEED_KEY, true);
  }

  for (const subject of data.subjects) {
    await runRequest(SUBJECT_STORE, "readwrite", (store) => store.put(subject));
  }

  for (const task of data.tasks) {
    await runRequest(TASK_STORE, "readwrite", (store) => store.put(task));
    await addSubject(task.subject);
  }

  for (const note of data.quickNotes) {
    await runRequest(QUICK_NOTE_STORE, "readwrite", (store) => store.put(note));
  }

  if (data.settings.theme) {
    await setAppTheme(data.settings.theme);
  }

  return {
    mode: normalizedMode,
    taskCount: data.tasks.length,
    subjectCount: data.subjects.length,
    quickNoteCount: data.quickNotes.length
  };
}

async function seedDemoTasks() {
  await setMeta(DEMO_SEED_KEY, true);
}

function normalizeImportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Le fichier importé n'est pas un JSON DueList valide.");
  }

  const settings = normalizeImportSettings(payload.settings || {});
  const subjects = normalizeImportSubjects(payload.subjects || []);
  const tasks = normalizeImportTasks(payload.tasks || []);
  const quickNotes = normalizeImportQuickNotes(payload.quickNotes || []);

  return {
    settings,
    subjects,
    tasks,
    quickNotes
  };
}

function normalizeImportSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  return {
    theme: settings.theme === "dark" ? "dark" : settings.theme === "light" ? "light" : ""
  };
}

function normalizeImportSubjects(subjects) {
  if (!Array.isArray(subjects)) {
    throw new Error("La liste des matières du fichier JSON est invalide.");
  }

  return subjects.map((subject) => {
    if (typeof subject === "string") {
      return normalizeSubject({ name: subject });
    }

    if (!subject || typeof subject !== "object") {
      throw new Error("Une matière du fichier JSON est invalide.");
    }

    return normalizeSubject(subject);
  });
}

function normalizeImportTasks(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error("La liste des devoirs du fichier JSON est invalide.");
  }

  return tasks.map((task) => {
    if (!task || typeof task !== "object") {
      throw new Error("Un devoir du fichier JSON est invalide.");
    }

    const normalizedTask = normalizeTask(task);

    if (!normalizedTask.subject || !normalizedTask.title || !isISODate(normalizedTask.dueDate)) {
      throw new Error("Un devoir du fichier JSON ne contient pas de matière, de titre ou de date valide.");
    }

    return normalizedTask;
  });
}

function normalizeImportQuickNotes(notes) {
  if (!Array.isArray(notes)) {
    throw new Error("La liste des notes rapides du fichier JSON est invalide.");
  }

  return notes
    .map((note) => {
      if (typeof note === "string") {
        return normalizeQuickNote({ content: note });
      }

      if (!note || typeof note !== "object") {
        throw new Error("Une note rapide du fichier JSON est invalide.");
      }

      return normalizeQuickNote(note);
    })
    .filter((note) => note.content);
}

function normalizeTask(task) {
  const now = new Date().toISOString();
  let archiveReason = normalizeArchiveReason(task.archiveReason);

  if (!archiveReason && Boolean(task.completed)) {
    archiveReason = "completed";
  }

  const archived = Boolean(task.archived) || Boolean(archiveReason);

  return {
    id: String(task.id || createId("task")),
    subject: String(task.subject || "").trim(),
    title: String(task.title || "").trim(),
    description: String(task.description || "").trim(),
    dueDate: String(task.dueDate || ""),
    estimatedMinutes: Number(task.estimatedMinutes) || 0,
    type: normalizeType(task.type),
    customType: String(task.customType || "").trim(),
    priority: normalizePriority(task.priority),
    isEvaluation: Boolean(task.isEvaluation),
    completed: Boolean(task.completed),
    completedAt: String(task.completedAt || (archiveReason === "completed" ? task.updatedAt || now : "")),
    archived,
    archiveReason,
    archivedAt: String(task.archivedAt || (archived ? task.updatedAt || now : "")),
    deletedAt: String(task.deletedAt || ""),
    createdAt: String(task.createdAt || now),
    updatedAt: String(task.updatedAt || now)
  };
}

function normalizeQuickNote(note) {
  const now = new Date().toISOString();

  return {
    id: String(note.id || createId("note")),
    content: String(note.content || "").trim(),
    createdAt: String(note.createdAt || now),
    updatedAt: String(note.updatedAt || now)
  };
}

function normalizeSubject(subject) {
  const name = String(subject.name || "").trim();
  const now = new Date().toISOString();

  return {
    id: String(subject.id || normalizeSubjectId(name) || createId("subject")),
    name,
    color: normalizeColor(subject.color) || getDefaultSubjectColor(name),
    createdAt: String(subject.createdAt || now),
    updatedAt: String(subject.updatedAt || now)
  };
}

function normalizeType(type) {
  const allowedTypes = ["homework", "test", "oral", "revision", "other"];
  return allowedTypes.includes(type) ? type : "homework";
}

function normalizePriority(priority) {
  const allowedPriorities = ["low", "normal", "urgent"];
  return allowedPriorities.includes(priority) ? priority : "normal";
}

function normalizeArchiveReason(reason) {
  const allowedReasons = ["completed", "deleted"];
  return allowedReasons.includes(reason) ? reason : "";
}

function normalizeColor(color) {
  const value = String(color || "").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
}

function isActiveTask(task) {
  return !task.completed && !task.archived;
}

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function compareTasks(firstTask, secondTask) {
  if (firstTask.dueDate !== secondTask.dueDate) {
    return firstTask.dueDate.localeCompare(secondTask.dueDate);
  }

  const priorityOrder = { urgent: 0, normal: 1, low: 2 };
  return priorityOrder[firstTask.priority] - priorityOrder[secondTask.priority];
}

async function countTasks() {
  return runRequest(TASK_STORE, "readonly", (store) => store.count());
}

async function getMeta(key) {
  const result = await runRequest(META_STORE, "readonly", (store) => store.get(key));
  return result ? result.value : null;
}

async function setMeta(key, value) {
  await runRequest(META_STORE, "readwrite", (store) => store.put({ key, value }));
}

async function runRequest(storeName, mode, requestFactory) {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    let result;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    try {
      request = requestFactory(store);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName) {
  await runRequest(storeName, "readwrite", (store) => store.clear());
}

function createId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${prefix || "item"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function getLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSubjectId(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getDefaultSubjectColor(name) {
  const text = String(name || "");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash + text.charCodeAt(index) * (index + 1)) % DEFAULT_SUBJECT_COLORS.length;
  }

  return DEFAULT_SUBJECT_COLORS[hash];
}

window.DueListDB = {
  initDB,
  getAllTasks,
  getArchivedTasks,
  addTask,
  updateTask,
  deleteTask,
  permanentlyDeleteTask,
  restoreTask,
  resetAppData,
  getQuickNotes,
  addQuickNote,
  deleteQuickNote,
  getAppTheme,
  setAppTheme,
  getSubjects,
  getSubjectRecords,
  addSubject,
  updateSubjectColor,
  markTaskCompleted,
  getTasksByDate,
  getUpcomingTasks,
  getTodayTasks,
  getWeekTasks,
  getImportantEvaluations,
  getTaskById,
  exportAppData,
  importAppData,
  seedDemoTasks
};
})();
