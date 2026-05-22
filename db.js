(function () {
if (window.DueListDB) {
  return;
}

const DB_NAME = "duelist-db";
const DB_VERSION = 3;
const TASK_STORE = "tasks";
const META_STORE = "meta";
const SUBJECT_STORE = "subjects";
const QUICK_NOTE_STORE = "quickNotes";
const DEMO_SEED_KEY = "demoSeeded";
const THEME_KEY = "theme";

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

      if (!db.objectStoreNames.contains(TASK_STORE)) {
        const taskStore = db.createObjectStore(TASK_STORE, { keyPath: "id" });
        taskStore.createIndex("dueDate", "dueDate", { unique: false });
        taskStore.createIndex("completed", "completed", { unique: false });
        taskStore.createIndex("isEvaluation", "isEvaluation", { unique: false });
        taskStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(SUBJECT_STORE)) {
        const subjectStore = db.createObjectStore(SUBJECT_STORE, { keyPath: "id" });
        subjectStore.createIndex("name", "name", { unique: false });
      }

      if (!db.objectStoreNames.contains(QUICK_NOTE_STORE)) {
        const quickNoteStore = db.createObjectStore(QUICK_NOTE_STORE, { keyPath: "id" });
        quickNoteStore.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

async function getAllTasks() {
  const tasks = await runRequest(TASK_STORE, "readonly", (store) => store.getAll());
  return [...(tasks || [])].sort(compareTasks);
}

async function addTask(task) {
  const now = new Date().toISOString();
  const savedTask = normalizeTask({
    ...task,
    id: task.id || createId(),
    completed: Boolean(task.completed),
    createdAt: task.createdAt || now,
    updatedAt: now
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.add(savedTask));
  return savedTask;
}

async function updateTask(task) {
  const savedTask = normalizeTask({
    ...task,
    updatedAt: new Date().toISOString()
  });

  await runRequest(TASK_STORE, "readwrite", (store) => store.put(savedTask));
  return savedTask;
}

async function deleteTask(id) {
  await runRequest(TASK_STORE, "readwrite", (store) => store.delete(id));
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
  return [...(notes || [])].sort((firstNote, secondNote) => {
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
    id: createId(),
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
  const subjects = await runRequest(SUBJECT_STORE, "readonly", (store) => store.getAll());
  return [...(subjects || [])]
    .map((subject) => subject.name)
    .filter(Boolean)
    .sort((firstSubject, secondSubject) => firstSubject.localeCompare(secondSubject, "fr"));
}

async function addSubject(name) {
  const cleanName = String(name || "").trim();

  if (!cleanName) {
    return null;
  }

  const subject = {
    id: normalizeSubjectId(cleanName),
    name: cleanName,
    createdAt: new Date().toISOString()
  };

  await runRequest(SUBJECT_STORE, "readwrite", (store) => store.put(subject));
  return subject.name;
}

async function markTaskCompleted(id) {
  const task = await getTaskById(id);

  if (!task) {
    return null;
  }

  const updatedTask = {
    ...task,
    completed: true,
    updatedAt: new Date().toISOString()
  };

  await updateTask(updatedTask);
  return updatedTask;
}

async function getTasksByDate(date) {
  const tasks = await getAllTasks();
  return tasks.filter((task) => !task.completed && task.dueDate === date);
}

async function getUpcomingTasks() {
  const today = getLocalISODate(new Date());
  const limit = getLocalISODate(addDays(new Date(), 14));
  const tasks = await getAllTasks();

  return tasks.filter((task) => {
    return !task.completed && task.dueDate > today && task.dueDate <= limit;
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
    return !task.completed && task.dueDate >= today && task.dueDate <= limit;
  });
}

async function getImportantEvaluations() {
  const today = getLocalISODate(new Date());
  const limit = getLocalISODate(addDays(new Date(), 30));
  const tasks = await getAllTasks();

  return tasks
    .filter((task) => {
      return !task.completed && task.isEvaluation && task.dueDate >= today && task.dueDate <= limit;
    })
    .slice(0, 5);
}

async function getTaskById(id) {
  return runRequest(TASK_STORE, "readonly", (store) => store.get(id));
}

async function seedDemoTasks() {
  const alreadySeeded = await getMeta(DEMO_SEED_KEY);
  const totalTasks = await countTasks();

  if (alreadySeeded || totalTasks > 0) {
    return;
  }

  const today = new Date();
  const demoTasks = [
    {
      subject: "Mathématiques",
      title: "Exercices d'algèbre linéaire",
      description: "Terminer la série n°4 sur les vecteurs.",
      dueDate: getLocalISODate(today),
      estimatedMinutes: 45,
      type: "homework",
      customType: "",
      priority: "urgent",
      isEvaluation: false
    },
    {
      subject: "Histoire",
      title: "Lecture chapitre 12",
      description: "Préparer les questions sur la Révolution industrielle.",
      dueDate: getLocalISODate(addDays(today, 1)),
      estimatedMinutes: 30,
      type: "revision",
      customType: "",
      priority: "normal",
      isEvaluation: false
    },
    {
      subject: "Physique-Chimie",
      title: "Compte-rendu de TP",
      description: "Finaliser les observations et la conclusion.",
      dueDate: getLocalISODate(addDays(today, 2)),
      estimatedMinutes: 60,
      type: "homework",
      customType: "",
      priority: "normal",
      isEvaluation: false
    },
    {
      subject: "Anglais",
      title: "Préparation exposé oral",
      description: "Répéter l'introduction et vérifier le vocabulaire.",
      dueDate: getLocalISODate(addDays(today, 3)),
      estimatedMinutes: 35,
      type: "oral",
      customType: "",
      priority: "low",
      isEvaluation: false
    },
    {
      subject: "Français",
      title: "Révision commentaire composé",
      description: "Relire la méthode et préparer deux exemples.",
      dueDate: getLocalISODate(addDays(today, 4)),
      estimatedMinutes: 50,
      type: "revision",
      customType: "",
      priority: "normal",
      isEvaluation: false
    },
    {
      subject: "Mathématiques",
      title: "DS de probabilités",
      description: "Revoir les lois de probabilité et les exercices corrigés.",
      dueDate: getLocalISODate(addDays(today, 5)),
      estimatedMinutes: 75,
      type: "test",
      customType: "",
      priority: "urgent",
      isEvaluation: true
    }
  ];

  for (const task of demoTasks) {
    await addTask(task);
    await addSubject(task.subject);
  }

  await setMeta(DEMO_SEED_KEY, true);
}

function normalizeTask(task) {
  return {
    id: String(task.id),
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
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString()
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

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

window.DueListDB = {
  initDB,
  getAllTasks,
  addTask,
  updateTask,
  deleteTask,
  resetAppData,
  getQuickNotes,
  addQuickNote,
  deleteQuickNote,
  getAppTheme,
  setAppTheme,
  getSubjects,
  addSubject,
  markTaskCompleted,
  getTasksByDate,
  getUpcomingTasks,
  getTodayTasks,
  getWeekTasks,
  getImportantEvaluations,
  getTaskById,
  seedDemoTasks
};
})();
