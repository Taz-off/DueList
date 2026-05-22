(function () {
if (window.DueListAppStarted) {
  return;
}

window.DueListAppStarted = true;

const storage = window.DueListDB || {};
const {
  addQuickNote,
  addTask,
  deleteTask,
  deleteQuickNote,
  getAllTasks,
  getAppTheme,
  getImportantEvaluations,
  getQuickNotes,
  getSubjects,
  getTaskById,
  getTasksByDate,
  getTodayTasks,
  getUpcomingTasks,
  initDB,
  markTaskCompleted,
  resetAppData,
  setAppTheme,
  addSubject,
  seedDemoTasks,
  updateTask
} = storage;

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const state = {
  route: "home",
  tasks: [],
  quickNotes: [],
  subjects: [],
  todayTasks: [],
  upcomingTasks: [],
  importantEvaluations: [],
  selectedDate: toISODate(new Date()),
  calendarDate: startOfMonth(new Date()),
  editingTaskId: null,
  theme: "light",
  isReady: false,
  startupError: null
};

let navigationIsBound = false;

const typeLabels = {
  homework: "Devoir",
  test: "Contrôle",
  oral: "Oral",
  revision: "Révision",
  other: "Autre"
};

const priorityLabels = {
  low: "Basse",
  normal: "Normale",
  urgent: "Urgente"
};

const routes = ["home", "agenda", "add", "notes", "settings"];

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}

async function startApp() {
  addManifestLink();
  bindNavigation();
  setInitialRoute();
  render();

  try {
    if (!window.DueListDB || typeof initDB !== "function") {
      throw new Error("Le fichier db.js n'a pas été chargé correctement.");
    }

    await initDB();
    await seedDemoTasks();
    state.theme = await getAppTheme();
    applyTheme(state.theme);
    await loadTaskCollections();
    state.isReady = true;
    render();
    registerServiceWorker();
  } catch (error) {
    state.startupError = error;
    render();
  }
}

function addManifestLink() {
  if (window.location.protocol === "file:" || document.querySelector('link[rel="manifest"]')) {
    return;
  }

  const manifestLink = document.createElement("link");
  manifestLink.rel = "manifest";
  manifestLink.href = "./manifest.webmanifest";
  document.head.appendChild(manifestLink);
}

function bindNavigation() {
  if (navigationIsBound) {
    return;
  }

  navigationIsBound = true;

  document.body.addEventListener("click", async (event) => {
    const routeButton = event.target.closest("[data-route]");
    const actionButton = event.target.closest("[data-action]");

    if (actionButton?.id === "dark-mode-toggle") {
      return;
    }

    if (routeButton) {
      navigateTo(routeButton.dataset.route);
      return;
    }

    if (actionButton) {
      await handleAction(actionButton);
    }
  });

  document.body.addEventListener("change", async (event) => {
    if (event.target.matches("#dark-mode-toggle")) {
      await handleAction(event.target);
    }
  });

  window.addEventListener("hashchange", () => {
    const nextRoute = getRouteFromHash();

    if (nextRoute !== state.route) {
      state.route = nextRoute;
      state.editingTaskId = null;
      render();
    }
  });
}

function setInitialRoute() {
  const route = getRouteFromHash();
  state.route = route;

  if (!window.location.hash) {
    history.replaceState(null, "", "#home");
  }
}

function getRouteFromHash() {
  const route = window.location.hash.replace("#", "");
  return routes.includes(route) ? route : "home";
}

function navigateTo(route, options = {}) {
  if (!routes.includes(route)) {
    return;
  }

  state.route = route;
  state.editingTaskId = options.editingTaskId || null;

  if (window.location.hash !== `#${route}`) {
    window.location.hash = route;
  }

  render();
  app.focus({ preventScroll: true });
}

async function loadTaskCollections() {
  const [tasks, subjects, quickNotes, todayTasks, upcomingTasks, importantEvaluations] = await Promise.all([
    getAllTasks(),
    getSubjects(),
    getQuickNotes(),
    getTodayTasks(),
    getUpcomingTasks(),
    getImportantEvaluations()
  ]);

  state.tasks = tasks;
  state.subjects = mergeSubjects(subjects, tasks.map((task) => task.subject));
  state.quickNotes = quickNotes;
  state.todayTasks = todayTasks;
  state.upcomingTasks = upcomingTasks;
  state.importantEvaluations = importantEvaluations;
}

function render() {
  updateActiveNavigation();

  if (state.startupError) {
    app.innerHTML = renderFatalError(state.startupError);
    return;
  }

  if (!state.isReady) {
    app.innerHTML = renderLoading();
    return;
  }

  if (state.route === "agenda") {
    renderAgenda();
    return;
  }

  if (state.route === "add") {
    renderAdd();
    return;
  }

  if (state.route === "notes") {
    renderNotes();
    return;
  }

  if (state.route === "settings") {
    renderSettings();
    return;
  }

  renderHome();
}

function updateActiveNavigation() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    const isActive = button.dataset.route === state.route;
    button.classList.toggle("is-active", isActive);
    button.toggleAttribute("aria-current", isActive);
  });
}

function renderHome() {
  app.innerHTML = `
    <section class="home-view" aria-labelledby="home-title">
      <header class="page-header">
        <div>
          <p class="eyebrow">DueList</p>
          <h1 id="home-title">Agenda scolaire</h1>
          <p class="page-subtitle">Bonjour, prêt pour tes cours ?</p>
        </div>
        <div class="header-actions">
          <button class="secondary-button danger-button" type="button" data-action="reset-app">Réinitialiser l'app</button>
          <button class="primary-button" type="button" data-route="add">Ajouter un devoir</button>
        </div>
      </header>

      <div class="home-layout">
        <div class="home-main">
          <section class="content-section" aria-labelledby="today-title">
            <div class="section-heading">
              <div>
                <p class="section-kicker">${formatShortDate(toISODate(new Date()))}</p>
                <h2 id="today-title">Aujourd'hui</h2>
              </div>
              <span class="section-count">${state.todayTasks.length}</span>
            </div>
            ${renderTaskList(state.todayTasks, "Aucun devoir aujourd'hui.")}
          </section>

          <section class="content-section" aria-labelledby="upcoming-title">
            <div class="section-heading">
              <div>
                <p class="section-kicker">14 prochains jours</p>
                <h2 id="upcoming-title">Prochainement</h2>
              </div>
              <span class="section-count">${state.upcomingTasks.length}</span>
            </div>
            ${renderTaskList(state.upcomingTasks.slice(0, 6), "Aucun devoir à venir.")}
          </section>

        </div>

        <aside class="evaluation-card" aria-labelledby="evaluation-title">
          <div class="evaluation-header">
            <p class="section-kicker">Priorité</p>
            <h2 id="evaluation-title">Évaluations importantes</h2>
          </div>
          ${renderEvaluationList()}
        </aside>
      </div>
    </section>
  `;

}

function renderEvaluationList() {
  if (!state.importantEvaluations.length) {
    return `
      <div class="empty-state compact">
        <strong>Aucune évaluation proche</strong>
        <span>Les contrôles à venir apparaîtront ici.</span>
      </div>
    `;
  }

  return `
    <div class="evaluation-list">
      ${state.importantEvaluations.map((task) => renderEvaluationItem(task)).join("")}
    </div>
  `;
}

function renderEvaluationItem(task) {
  return `
    <article class="evaluation-item">
      <span class="date-chip">${formatDayNumber(task.dueDate)}</span>
      <div>
        <strong>${escapeHTML(task.subject)}</strong>
        <span>${escapeHTML(task.title)}</span>
        <small>${formatLongDate(task.dueDate)}</small>
      </div>
    </article>
  `;
}

function renderNotes() {
  app.innerHTML = `
    <section class="notes-view" aria-labelledby="notes-title">
      <header class="page-header compact-header">
        <div>
          <p class="eyebrow">Idées et rappels</p>
          <h1 id="notes-title">Notes rapides</h1>
        </div>
      </header>

      <section class="content-section notes-panel" aria-label="Ajouter une note rapide">
        <form class="quick-note-form" id="quick-note-form">
          <label class="field">
            <span>Nouvelle note</span>
            <textarea id="quick-note-input" name="quickNote" rows="4" placeholder="Ex : penser à prendre la calculatrice"></textarea>
          </label>
          <button class="primary-button" type="submit">Ajouter la note</button>
        </form>
        ${renderQuickNotes()}
      </section>
    </section>
  `;

  bindQuickNoteForm();
}

function renderSettings() {
  app.innerHTML = `
    <section class="settings-view" aria-labelledby="settings-title">
      <header class="page-header compact-header">
        <div>
          <p class="eyebrow">Application</p>
          <h1 id="settings-title">Paramètres</h1>
        </div>
      </header>

      <section class="settings-panel" aria-label="Préférences">
        <div class="settings-heading">
          <span class="settings-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path>
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.82 2.82l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 0 1-2.82-2.82l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.04A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 0 1 2.82-2.82l.04.04a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 0 1 2.82 2.82l-.04.04a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 21 10h.04a2 2 0 0 1 0 4H21a1.7 1.7 0 0 0-1.56 1.04Z"></path>
            </svg>
          </span>
          <strong>Préférences</strong>
        </div>
        <label class="switch-row">
          <span>Mode sombre</span>
          <input id="dark-mode-toggle" type="checkbox" data-action="toggle-theme" ${state.theme === "dark" ? "checked" : ""}>
        </label>
      </section>
    </section>
  `;
}

function renderQuickNotes() {
  if (!state.quickNotes.length) {
    return `
      <div class="empty-state quick-note-empty">
        <strong>Aucune note rapide</strong>
        <span>Ajoute une petite note pour ne rien oublier.</span>
      </div>
    `;
  }

  return `
    <div class="quick-note-list">
      ${state.quickNotes.map((note) => renderQuickNote(note)).join("")}
    </div>
  `;
}

function renderQuickNote(note) {
  return `
    <article class="quick-note-card">
      <p>${escapeHTML(note.content)}</p>
      <button class="text-button danger" type="button" data-action="delete-quick-note" data-id="${escapeAttribute(note.id)}">
        Supprimer
      </button>
    </article>
  `;
}

function bindQuickNoteForm() {
  const quickNoteForm = document.querySelector("#quick-note-form");

  if (!quickNoteForm) {
    return;
  }

  quickNoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveQuickNoteFromForm(quickNoteForm);
  });
}

function renderAgenda() {
  const selectedDateLabel = formatLongDate(state.selectedDate);

  app.innerHTML = `
    <section class="agenda-view" aria-labelledby="agenda-title">
      <header class="page-header compact-header">
        <div>
          <p class="eyebrow">Calendrier</p>
          <h1 id="agenda-title">Agenda</h1>
        </div>
      </header>

      <div class="agenda-layout">
        <section class="calendar-panel" aria-label="Calendrier mensuel">
          <div class="calendar-header">
            <button class="secondary-button small-button" type="button" data-action="previous-month">Précédent</button>
            <h2>${formatMonthTitle(state.calendarDate)}</h2>
            <div class="calendar-actions">
              <button class="secondary-button small-button" type="button" data-action="go-today">Aujourd'hui</button>
              <button class="secondary-button small-button" type="button" data-action="next-month">Suivant</button>
            </div>
          </div>
          ${renderCalendar()}
        </section>

        <section class="selected-day-panel" aria-labelledby="selected-day-title">
          <div class="section-heading">
            <div>
              <p class="section-kicker">Jour sélectionné</p>
              <h2 id="selected-day-title">${selectedDateLabel}</h2>
            </div>
            <button class="secondary-button small-button" type="button" data-action="add-selected-date">
              Ajouter un devoir ce jour
            </button>
          </div>
          <div id="selected-day-tasks" class="selected-day-tasks">
            ${renderSelectedDayTasks()}
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderCalendar() {
  const days = getCalendarDays(state.calendarDate);
  const activeTasks = state.tasks.filter((task) => !task.completed);

  return `
    <div class="weekday-grid" aria-hidden="true">
      ${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="calendar-grid">
      ${days.map((day) => renderCalendarDay(day, activeTasks)).join("")}
    </div>
  `;
}

function renderCalendarDay(day, activeTasks) {
  const date = toISODate(day.date);
  const tasksForDay = activeTasks.filter((task) => task.dueDate === date);
  const hasEvaluation = tasksForDay.some((task) => task.isEvaluation);
  const isSelected = date === state.selectedDate;
  const isToday = date === toISODate(new Date());
  const taskCount = tasksForDay.length;
  const classes = [
    "calendar-day",
    day.isCurrentMonth ? "" : "is-outside-month",
    isSelected ? "is-selected" : "",
    isToday ? "is-today" : "",
    taskCount ? "has-tasks" : "",
    hasEvaluation ? "has-evaluation" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <button class="${classes}" type="button" data-action="select-date" data-date="${date}" aria-pressed="${isSelected}">
      <span class="calendar-day-number">${day.date.getDate()}</span>
      <span class="calendar-indicators" aria-hidden="true">
        ${taskCount ? `<span class="task-dot"></span>` : ""}
        ${hasEvaluation ? `<span class="evaluation-dot"></span>` : ""}
      </span>
      ${taskCount ? `<span class="calendar-task-count">${taskCount}</span>` : ""}
    </button>
  `;
}

function renderSelectedDayTasks() {
  const tasks = state.tasks.filter((task) => !task.completed && task.dueDate === state.selectedDate);

  if (!tasks.length) {
    return `
      <div class="empty-state">
        <strong>Aucun devoir ce jour-là</strong>
        <span>Choisis une autre date ou ajoute un devoir.</span>
      </div>
    `;
  }

  return renderTaskList(tasks, "", { compact: true });
}

async function renderAdd() {
  const editingTaskId = state.editingTaskId;
  const task = editingTaskId ? await getTaskById(editingTaskId) : null;

  if (state.route !== "add" || state.editingTaskId !== editingTaskId) {
    return;
  }

  const isEditing = Boolean(task);

  app.innerHTML = `
    <section class="add-view" aria-labelledby="add-title">
      <header class="page-header compact-header">
        <div>
          <p class="eyebrow">${isEditing ? "Modification" : "Nouveau"}</p>
          <h1 id="add-title">${isEditing ? "Modifier un devoir" : "Ajouter un devoir"}</h1>
        </div>
      </header>

      <form class="form-panel" id="task-form" novalidate>
        <div class="form-error" id="form-error" role="alert" hidden></div>

        <div class="form-grid">
          <div class="field subject-field">
            <div class="field-header">
              <label for="subject-input">Matière <strong aria-hidden="true">*</strong></label>
              <button class="text-button" type="button" data-action="save-subject">Ajouter une matière</button>
            </div>
            <input
              id="subject-input"
              type="text"
              name="subject"
              list="subject-options"
              autocomplete="off"
              value="${escapeAttribute(task?.subject || "")}"
              required
            >
            <datalist id="subject-options">
              ${renderSubjectOptions()}
            </datalist>
          </div>

          <label class="field">
            <span>Titre du devoir <strong aria-hidden="true">*</strong></span>
            <input type="text" name="title" autocomplete="off" value="${escapeAttribute(task?.title || "")}" required>
          </label>

          <label class="field span-2">
            <span>Description</span>
            <textarea name="description" rows="4">${escapeHTML(task?.description || "")}</textarea>
          </label>

          <label class="field">
            <span>Date d'échéance <strong aria-hidden="true">*</strong></span>
            <input type="date" name="dueDate" value="${escapeAttribute(task?.dueDate || state.selectedDate)}" required>
          </label>

          <label class="field">
            <span>Temps estimé en minutes</span>
            <input type="number" name="estimatedMinutes" min="0" step="5" inputmode="numeric" value="${task?.estimatedMinutes || ""}">
          </label>

          <label class="field">
            <span>Type</span>
            <select name="type" id="type-select">
              ${renderTypeOptions(task?.type || "homework")}
            </select>
          </label>

          <label class="field">
            <span>Priorité</span>
            <select name="priority">
              ${renderPriorityOptions(task?.priority || "normal")}
            </select>
          </label>

          <label class="field span-2 other-type-field ${task?.type === "other" ? "" : "is-hidden"}" id="other-type-field">
            <span>Préciser le type</span>
            <input type="text" name="customType" autocomplete="off" value="${escapeAttribute(task?.customType || "")}">
          </label>

          <label class="checkbox-field span-2">
            <input type="checkbox" name="isEvaluation" ${task?.isEvaluation ? "checked" : ""}>
            <span>C'est une évaluation</span>
          </label>
        </div>

        <div class="form-actions">
          <button class="secondary-button" type="button" data-action="cancel-form">Annuler</button>
          <button class="primary-button" type="submit">${isEditing ? "Mettre à jour" : "Enregistrer"}</button>
        </div>
      </form>
    </section>
  `;

  const form = document.querySelector("#task-form");
  const typeSelect = document.querySelector("#type-select");
  const otherTypeField = document.querySelector("#other-type-field");

  typeSelect.addEventListener("change", () => {
    otherTypeField.classList.toggle("is-hidden", typeSelect.value !== "other");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveTaskFromForm(form, task);
  });
}

function renderTypeOptions(selectedType) {
  return Object.entries(typeLabels)
    .map(([value, label]) => {
      return `<option value="${value}" ${value === selectedType ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function renderPriorityOptions(selectedPriority) {
  return Object.entries(priorityLabels)
    .map(([value, label]) => {
      return `<option value="${value}" ${value === selectedPriority ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function renderSubjectOptions() {
  return state.subjects
    .map((subject) => `<option value="${escapeAttribute(subject)}"></option>`)
    .join("");
}

async function saveTaskFromForm(form, existingTask) {
  const formData = new FormData(form);
  const subject = String(formData.get("subject") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const dueDate = String(formData.get("dueDate") || "").trim();
  const errorBox = form.querySelector("#form-error");

  if (!subject || !title || !dueDate) {
    errorBox.textContent = "La matière, le titre et la date d'échéance sont obligatoires.";
    errorBox.hidden = false;
    return;
  }

  const task = {
    ...(existingTask || {}),
    subject,
    title,
    dueDate,
    description: String(formData.get("description") || "").trim(),
    estimatedMinutes: Number(formData.get("estimatedMinutes")) || 0,
    type: String(formData.get("type") || "homework"),
    customType: String(formData.get("customType") || "").trim(),
    priority: String(formData.get("priority") || "normal"),
    isEvaluation: formData.get("isEvaluation") === "on",
    completed: existingTask?.completed || false
  };

  if (existingTask) {
    await updateTask(task);
    showToast("Devoir mis à jour.");
  } else {
    await addTask(task);
    showToast("Devoir enregistré.");
  }

  await addSubject(subject);
  state.selectedDate = dueDate;
  state.calendarDate = startOfMonth(parseISODate(dueDate));
  state.editingTaskId = null;
  await loadTaskCollections();
  navigateTo("home");
}

function renderTaskList(tasks, emptyMessage, options = {}) {
  if (!tasks.length) {
    return emptyMessage
      ? `
        <div class="empty-state">
          <strong>${emptyMessage}</strong>
          <span>Tu peux ajouter un devoir depuis l'onglet Ajouter.</span>
        </div>
      `
      : "";
  }

  const className = options.compact ? "task-list compact-list" : "task-list";
  return `<div class="${className}">${tasks.map((task) => renderTaskCard(task, options)).join("")}</div>`;
}

function renderTaskCard(task, options = {}) {
  const typeLabel = task.type === "other" && task.customType ? task.customType : typeLabels[task.type];
  const compactClass = options.compact ? "is-compact" : "";
  const description = task.description
    ? `<p class="task-description">${escapeHTML(task.description)}</p>`
    : `<p class="task-description muted">Aucune description.</p>`;

  return `
    <article class="task-card ${compactClass}" data-task-id="${escapeAttribute(task.id)}">
      <div class="task-main">
        <div>
          <p class="task-subject">${escapeHTML(task.subject)}</p>
          <h3>${escapeHTML(task.title)}</h3>
          ${description}
        </div>
        <button class="complete-button" type="button" data-action="complete-task" data-id="${escapeAttribute(task.id)}">
          <span aria-hidden="true"></span>
          Fait
        </button>
      </div>
      <div class="task-meta">
        <span class="meta-pill">${formatLongDate(task.dueDate)}</span>
        ${task.estimatedMinutes ? `<span class="meta-pill">${task.estimatedMinutes} min</span>` : ""}
        <span class="badge priority-${task.priority}">${priorityLabels[task.priority]}</span>
        <span class="badge type-badge">${escapeHTML(typeLabel)}</span>
        ${task.isEvaluation ? `<span class="badge evaluation-badge">Évaluation</span>` : ""}
      </div>
      <div class="task-actions">
        <button class="text-button" type="button" data-action="edit-task" data-id="${escapeAttribute(task.id)}">Modifier</button>
        <button class="text-button danger" type="button" data-action="delete-task" data-id="${escapeAttribute(task.id)}">Supprimer</button>
      </div>
    </article>
  `;
}

async function handleAction(button) {
  const action = button.dataset.action;

  if (action === "previous-month") {
    state.calendarDate = addMonths(state.calendarDate, -1);
    renderAgenda();
    return;
  }

  if (action === "next-month") {
    state.calendarDate = addMonths(state.calendarDate, 1);
    renderAgenda();
    return;
  }

  if (action === "go-today") {
    const today = new Date();
    state.selectedDate = toISODate(today);
    state.calendarDate = startOfMonth(today);
    renderAgenda();
    return;
  }

  if (action === "select-date") {
    state.selectedDate = button.dataset.date;
    renderAgenda();
    return;
  }

  if (action === "add-selected-date") {
    state.editingTaskId = null;
    navigateTo("add");
    return;
  }

  if (action === "save-subject") {
    await saveSubjectFromCurrentForm();
    return;
  }

  if (action === "delete-quick-note") {
    await deleteQuickNote(button.dataset.id);
    await loadTaskCollections();
    showToast("Note supprimée.");
    render();
    return;
  }

  if (action === "toggle-theme") {
    const nextTheme = button.checked ? "dark" : "light";
    state.theme = await setAppTheme(nextTheme);
    applyTheme(state.theme);
    showToast(state.theme === "dark" ? "Mode sombre activé." : "Mode clair activé.");
    return;
  }

  if (action === "complete-task") {
    await markTaskCompleted(button.dataset.id);
    await loadTaskCollections();
    showToast("Devoir marqué comme terminé.");
    render();
    return;
  }

  if (action === "edit-task") {
    navigateTo("add", { editingTaskId: button.dataset.id });
    return;
  }

  if (action === "delete-task") {
    const confirmed = window.confirm("Supprimer ce devoir ?");

    if (confirmed) {
      await deleteTask(button.dataset.id);
      await loadTaskCollections();
      showToast("Devoir supprimé.");
      render();
    }
    return;
  }

  if (action === "cancel-form") {
    state.editingTaskId = null;
    navigateTo("home");
    return;
  }

  if (action === "reset-app") {
    const confirmed = window.confirm("Réinitialiser DueList ? Tous les devoirs seront supprimés.");

    if (!confirmed) {
      return;
    }

    await resetAppData();
    state.tasks = [];
    state.quickNotes = [];
    state.subjects = [];
    state.todayTasks = [];
    state.upcomingTasks = [];
    state.importantEvaluations = [];
    state.selectedDate = toISODate(new Date());
    state.calendarDate = startOfMonth(new Date());
    state.editingTaskId = null;
    state.theme = "light";
    state.startupError = null;
    state.isReady = true;
    applyTheme(state.theme);
    showToast("Application réinitialisée.");
    navigateTo("home");
  }
}

async function saveQuickNoteFromForm(form) {
  const input = form.querySelector("#quick-note-input");
  const content = String(input?.value || "").trim();

  if (!content) {
    showToast("Écris une note avant de l'ajouter.");
    return;
  }

  await addQuickNote(content);
  input.value = "";
  await loadTaskCollections();
  showToast("Note ajoutée.");
  render();
}

async function saveSubjectFromCurrentForm() {
  const subjectInput = document.querySelector("#subject-input");
  const errorBox = document.querySelector("#form-error");
  const subject = String(subjectInput?.value || "").trim();

  if (!subject) {
    if (errorBox) {
      errorBox.textContent = "Écris d'abord le nom de la matière à ajouter.";
      errorBox.hidden = false;
    }
    return;
  }

  await addSubject(subject);
  state.subjects = mergeSubjects(state.subjects, [subject]);

  const subjectOptions = document.querySelector("#subject-options");
  if (subjectOptions) {
    subjectOptions.innerHTML = renderSubjectOptions();
  }

  if (errorBox) {
    errorBox.hidden = true;
  }

  showToast("Matière ajoutée.");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
    return;
  }

  let isRefreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register("./sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {
      showToast("Mode hors-ligne non disponible pour cette session.");
    });
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute("content", nextTheme === "dark" ? "#0f172a" : "#2563eb");
  }

  const themeToggle = document.querySelector("#dark-mode-toggle");
  if (themeToggle) {
    themeToggle.checked = nextTheme === "dark";
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2600);
}

function renderFatalError(error) {
  return `
    <section class="fatal-error">
      <h1>DueList ne peut pas démarrer</h1>
      <p>${escapeHTML(error.message || "Une erreur inconnue est survenue.")}</p>
      <p class="error-help">Recharge la page. Si l'application a été ouverte depuis une ancienne version installée, vide le cache du site puis relance DueList.</p>
    </section>
  `;
}

function renderLoading() {
  return `
    <section class="fatal-error" aria-live="polite">
      <p class="eyebrow">DueList</p>
      <h1>Chargement de l'agenda</h1>
      <p>Préparation des devoirs locaux...</p>
    </section>
  `;
}

function getCalendarDays(date) {
  const firstDay = startOfMonth(date);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = addDays(firstDay, -firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const dayDate = addDays(startDate, index);

    return {
      date: dayDate,
      isCurrentMonth: dayDate.getMonth() === firstDay.getMonth()
    };
  });
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthTitle(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatLongDate(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(parseISODate(dateString));
}

function formatShortDate(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long"
  }).format(parseISODate(dateString));
}

function formatDayNumber(dateString) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short"
  }).format(parseISODate(dateString));
}

function mergeSubjects(...subjectGroups) {
  const subjectMap = new Map();

  subjectGroups.flat().forEach((subject) => {
    const cleanSubject = String(subject || "").trim();

    if (!cleanSubject) {
      return;
    }

    subjectMap.set(cleanSubject.toLocaleLowerCase("fr"), cleanSubject);
  });

  return [...subjectMap.values()].sort((firstSubject, secondSubject) => {
    return firstSubject.localeCompare(secondSubject, "fr");
  });
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value);
}
})();
