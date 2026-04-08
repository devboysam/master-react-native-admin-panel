import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'https://api.masterreactnative.dev';
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 20000);
const API_RETRIES = Number(import.meta.env.VITE_API_RETRIES || 2);
const SYNC_TIMEOUT_MS = Number(import.meta.env.VITE_SYNC_TIMEOUT_MS || 25000);

const NAV_ITEMS = ['Dashboard', 'Modules', 'Lessons', 'Settings'];

const initialModuleForm = {
  id: null,
  title: '',
  description: '',
  prerequisites: [],
  icon: 'book',
  image_url: '',
  order_index: 0,
  background_color: '#61DAFB',
};

const initialLessonForm = {
  id: null,
  module_id: '',
  title: '',
  description: '',
  read_time: '',
  lesson_order: '',
  content: '',
};

const lessonSyntaxTemplate = `<h2>Section Heading</h2>
<p>This lesson supports <strong>bold text</strong>, paragraphs, and code blocks.</p>

<pre><code>import React from 'react';
import { View, Text } from 'react-native';

export default function Example() {
  return <Text>Hello React Native</Text>;
}</code></pre>`;

function formatError(error, fallback) {
  if (error?.response?.data?.message) {
    return error.response.data.message;
  }
  if (error?.response?.status) {
    return `${fallback} (HTTP ${error.response.status})`;
  }
  return fallback;
}

function parsePrerequisites(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9A-Fa-f]{6}$/.test(withHash) ? withHash.toUpperCase() : null;
}

function parseOptionalNumberInput(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeImageUrlInput(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function convertPlainTextToHtml(rawContent) {
  const codeBlocks = [];

  let html = String(rawContent || '').replace(/```(\w+)?\n([\s\S]*?)```/g, (_, language, code) => {
    const token = `{{{CODE_BLOCK_${codeBlocks.length}}}}`;
    codeBlocks.push({ language: language || '', code });
    return token;
  });

  html = escapeHtml(html);

  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_, alt, src) => {
    return `<img src="${src}" alt="${escapeHtml(alt)}" />`;
  });

  html = html.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />');
  html = `<p>${html}</p>`;
  html = html.replace(/<p>\s*({{{CODE_BLOCK_\d+}}})\s*<\/p>/g, '$1');

  codeBlocks.forEach((block, index) => {
    const token = `{{{CODE_BLOCK_${index}}}}`;
    const languageClass = block.language ? `language-${block.language}` : '';
    const renderedBlock = `<pre><code class="${languageClass}">${escapeHtml(block.code)}</code></pre>`;
    html = html.replace(token, renderedBlock);
  });

  return html;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWithRetry(url, options = {}) {
  const retries = Number(options.retries ?? API_RETRIES);
  const timeout = Number(options.timeout ?? API_TIMEOUT_MS);
  const signal = options.signal;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await axios.get(url, { timeout, signal });
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal?.aborted) {
        throw error;
      }
      lastError = error;
      if (attempt >= retries) {
        throw lastError;
      }
      await wait(350 * (attempt + 1));
    }
  }

  throw lastError;
}

function buildLessonPreviewHtml(rawContent) {
  const text = String(rawContent || '').trim();
  if (!text) {
    return '';
  }

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(text);
  const candidate = looksLikeHtml ? text : convertPlainTextToHtml(text);

  return DOMPurify.sanitize(candidate, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'em', 'ul', 'ol', 'li',
      'pre', 'code', 'blockquote', 'a', 'img', 'span',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class'],
  });
}

function App() {
  const [activePage, setActivePage] = useState('Dashboard');
  const [modules, setModules] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [moduleQuery, setModuleQuery] = useState('');
  const [moduleSort, setModuleSort] = useState('order-asc');
  const [moduleForm, setModuleForm] = useState(initialModuleForm);
  const [lessonForm, setLessonForm] = useState(initialLessonForm);
  const [modulePrerequisiteInput, setModulePrerequisiteInput] = useState('');
  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [isLessonModalOpen, setIsLessonModalOpen] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [apiHealth, setApiHealth] = useState('Unknown');
  const lessonPreviewRef = useRef(null);
  const moduleModalScrollRef = useRef(null);
  const lessonModalScrollRef = useRef(null);
  const lessonEditRequestIdRef = useRef(0);

  const totalLessons = lessons.length;

  const moduleMap = useMemo(() => {
    return modules.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [modules]);

  const moduleOrderMap = useMemo(() => {
    return modules.reduce((acc, item) => {
      acc[item.id] = Number(item.order_index) || 0;
      return acc;
    }, {});
  }, [modules]);

  const latestLessons = lessons.slice(0, 6);
  const lessonPreviewHtml = useMemo(() => buildLessonPreviewHtml(lessonForm.content), [lessonForm.content]);

  const filteredModules = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase();
    const rows = modules.filter((item) => {
      const prerequisites = parsePrerequisites(item.prerequisites).join(' ').toLowerCase();
      const searchable = [item.title, item.description, prerequisites].join(' ').toLowerCase();
      return !query || searchable.includes(query);
    });

    return [...rows].sort((a, b) => {
      if (moduleSort === 'title-asc') return String(a.title || '').localeCompare(String(b.title || ''));
      if (moduleSort === 'title-desc') return String(b.title || '').localeCompare(String(a.title || ''));
      if (moduleSort === 'lessons-desc') return Number(b.lesson_count || 0) - Number(a.lesson_count || 0);
      if (moduleSort === 'time-desc') return Number(b.total_read_time || 0) - Number(a.total_read_time || 0);
      return Number(a.order_index || 0) - Number(b.order_index || 0);
    });
  }, [modules, moduleQuery, moduleSort]);

  const orderedLessons = useMemo(() => {
    return [...lessons].sort((a, b) => {
      const aModuleOrder = moduleOrderMap[a.module_id] ?? Number.MAX_SAFE_INTEGER;
      const bModuleOrder = moduleOrderMap[b.module_id] ?? Number.MAX_SAFE_INTEGER;

      if (aModuleOrder !== bModuleOrder) {
        return aModuleOrder - bModuleOrder;
      }

      if (Number(a.module_id || 0) !== Number(b.module_id || 0)) {
        return Number(a.module_id || 0) - Number(b.module_id || 0);
      }

      if (Number(a.lesson_order || 0) !== Number(b.lesson_order || 0)) {
        return Number(a.lesson_order || 0) - Number(b.lesson_order || 0);
      }

      return Number(a.id || 0) - Number(b.id || 0);
    });
  }, [lessons, moduleOrderMap]);

  useEffect(() => {
    if (!isLessonModalOpen || !lessonPreviewRef.current) return;
    lessonPreviewRef.current.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }, [isLessonModalOpen, lessonPreviewHtml]);

  function scrollModalToTop(modalRef) {
    requestAnimationFrame(() => {
      if (modalRef.current) {
        modalRef.current.scrollTop = 0;
      }
    });
  }

  async function fetchModulesAndLessons(options = {}) {
    const modulesResponse = await getWithRetry(`${API_BASE_URL}/api/modules`, { signal: options.signal });
    const moduleRows = modulesResponse.data.data || [];
    setModules(moduleRows);

    const modulesWithLessons = moduleRows.filter((item) => Number(item.lesson_count || 0) > 0);

    if (!modulesWithLessons.length) {
      setLessons([]);
      return;
    }

    const lessonRequests = modulesWithLessons.map((item) =>
      getWithRetry(`${API_BASE_URL}/api/modules/${item.id}/lessons`, { signal: options.signal })
        .then((response) => response.data.data || [])
        .catch((error) => {
          if (error?.code === 'ERR_CANCELED') throw error;
          return [];
        })
    );

    const groupedLessons = await Promise.all(lessonRequests);
    const mergedLessons = groupedLessons.flat().sort((a, b) => {
      if (Number(a.module_id) !== Number(b.module_id)) {
        return Number(a.module_id) - Number(b.module_id);
      }
      return Number(a.lesson_order || 0) - Number(b.lesson_order || 0);
    });

    setLessons(mergedLessons);
  }

  async function refreshAllData(showMessage = false) {
    setIsLoadingData(true);
    if (showMessage) setMessage({ type: '', text: '' });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      await fetchModulesAndLessons({ signal: controller.signal });
      setApiHealth('Connected');
      if (showMessage) setMessage({ type: 'success', text: 'Data synced successfully' });
    } catch (error) {
      setApiHealth('Unavailable');
      const fallback = error?.code === 'ERR_CANCELED' 
        ? `Modules/Lessons request timed out after ${Math.round(SYNC_TIMEOUT_MS / 1000)}s`
        : 'Modules/Lessons failed';
      setMessage({ type: 'error', text: `Backend sync issue: ${formatError(error, fallback)}` });
    } finally {
      clearTimeout(timeoutId);
      setIsLoadingData(false);
    }
  }

  useEffect(() => {
    refreshAllData(false);
  }, []);

  function openCreateModuleModal() {
    setModuleForm(initialModuleForm);
    setModulePrerequisiteInput('');
    setIsModuleModalOpen(true);
    scrollModalToTop(moduleModalScrollRef);
  }

  function openEditModuleModal(moduleItem) {
    const normalizedBgColor = normalizeHexColor(moduleItem.background_color) || '#61DAFB';
    setModuleForm({
      id: moduleItem.id,
      title: moduleItem.title || '',
      description: moduleItem.description || '',
      prerequisites: parsePrerequisites(moduleItem.prerequisites),
      icon: moduleItem.icon || 'book',
      image_url: moduleItem.image_url || '',
      order_index: Number(moduleItem.order_index) || 0,
      background_color: normalizedBgColor,
    });
    setModulePrerequisiteInput('');
    setIsModuleModalOpen(true);
    scrollModalToTop(moduleModalScrollRef);
  }

  function appendLessonSnippet(snippet) {
    setLessonForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content}\n\n${snippet}` : snippet,
    }));
  }

  function addPrerequisiteChip(value) {
    const chip = value.trim();
    if (!chip) return;

    setModuleForm((prev) => {
      if (prev.prerequisites.includes(chip)) return prev;
      return { ...prev, prerequisites: [...prev.prerequisites, chip] };
    });
    setModulePrerequisiteInput('');
  }

  function removePrerequisiteChip(chipToRemove) {
    setModuleForm((prev) => ({
      ...prev,
      prerequisites: prev.prerequisites.filter((chip) => chip !== chipToRemove),
    }));
  }

  async function handleSaveModule(event) {
    event.preventDefault();
    setIsSavingModule(true);
    setMessage({ type: '', text: '' });

    try {
      const normalizedTitle = String(moduleForm.title || '').trim();
      if (!normalizedTitle) {
        setMessage({ type: 'error', text: 'Module title is required' });
        setIsSavingModule(false);
        return;
      }

      const normalizedBgColor = normalizeHexColor(moduleForm.background_color);
      if (!normalizedBgColor) {
        setMessage({ type: 'error', text: 'Background color must be a 6-digit hex value like #61DAFB' });
        setIsSavingModule(false);
        return;
      }

      const normalizedImageUrl = normalizeImageUrlInput(moduleForm.image_url);
      if (normalizedImageUrl === undefined) {
        setMessage({ type: 'error', text: 'Image URL must start with http:// or https://' });
        setIsSavingModule(false);
        return;
      }

      const payload = {
        title: normalizedTitle,
        description: moduleForm.description,
        icon: moduleForm.icon,
        image_url: normalizedImageUrl,
        prerequisites: moduleForm.prerequisites.join(', '),
        order_index: Number(moduleForm.order_index) || 0,
        background_color: normalizedBgColor,
      };

      if (moduleForm.id) {
        await axios.put(`${API_BASE_URL}/api/modules/${moduleForm.id}`, payload);
      } else {
        await axios.post(`${API_BASE_URL}/api/modules`, payload);
      }

      setMessage({ type: 'success', text: moduleForm.id ? 'Module updated' : 'Module created' });
      setIsModuleModalOpen(false);
      setModuleForm(initialModuleForm);
      await fetchModulesAndLessons();
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to save module') });
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleDeleteModule(moduleId) {
    const confirmed = window.confirm('Delete this module and all related lessons?');
    if (!confirmed) return;

    try {
      await axios.delete(`${API_BASE_URL}/api/modules/${moduleId}`);
      setMessage({ type: 'success', text: 'Module deleted' });
      if (Number(lessonForm.module_id) === Number(moduleId)) {
        setLessonForm(initialLessonForm);
      }
      await fetchModulesAndLessons();
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to delete module') });
    }
  }

  function openCreateLessonModal() {
    setLessonForm(initialLessonForm);
    lessonEditRequestIdRef.current += 1;
    setIsLessonModalOpen(true);
    scrollModalToTop(lessonModalScrollRef);
  }

  function closeLessonModal() {
    lessonEditRequestIdRef.current += 1;
    setIsLessonModalOpen(false);
  }

  async function openEditLessonModal(lessonItem) {
    const requestId = lessonEditRequestIdRef.current + 1;
    lessonEditRequestIdRef.current = requestId;

    try {
      const response = await axios.get(`${API_BASE_URL}/api/lessons/${lessonItem.id}`);
      if (requestId !== lessonEditRequestIdRef.current) {
        return;
      }

      const fullLesson = response.data.data;
      setLessonForm({
        id: fullLesson.id,
        module_id: String(fullLesson.module_id),
        title: fullLesson.title || '',
        description: fullLesson.description || '',
        read_time: fullLesson.read_time ?? '',
        lesson_order: fullLesson.lesson_order ?? '',
        content: fullLesson.content || '',
      });
      setIsLessonModalOpen(true);
      scrollModalToTop(lessonModalScrollRef);
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to load lesson details') });
    }
  }

  async function handleSaveLesson(event) {
    event.preventDefault();
    setIsSavingLesson(true);
    setMessage({ type: '', text: '' });

    try {
      const normalizedTitle = String(lessonForm.title || '').trim();
      if (!normalizedTitle) {
        setMessage({ type: 'error', text: 'Lesson title is required' });
        setIsSavingLesson(false);
        return;
      }

      if (!lessonForm.module_id) {
        setMessage({ type: 'error', text: 'Please select a module' });
        setIsSavingLesson(false);
        return;
      }

      const parsedReadTime = parseOptionalNumberInput(lessonForm.read_time);
      if (Number.isNaN(parsedReadTime)) {
        setMessage({ type: 'error', text: 'Time needed must be a valid number or empty' });
        setIsSavingLesson(false);
        return;
      }

      if (parsedReadTime !== null && parsedReadTime < 0) {
        setMessage({ type: 'error', text: 'Time needed cannot be negative' });
        setIsSavingLesson(false);
        return;
      }

      const parsedLessonOrder = parseOptionalNumberInput(lessonForm.lesson_order);
      if (Number.isNaN(parsedLessonOrder)) {
        setMessage({ type: 'error', text: 'Lesson order must be a valid number or empty' });
        setIsSavingLesson(false);
        return;
      }

      const payload = {
        module_id: Number(lessonForm.module_id),
        title: normalizedTitle,
        description: lessonForm.description || '',
        content: lessonForm.content || '',
        read_time: parsedReadTime,
        lesson_order: parsedLessonOrder,
      };

      if (lessonForm.id) {
        await axios.put(`${API_BASE_URL}/api/lessons/${lessonForm.id}`, payload);
      } else {
        await axios.post(`${API_BASE_URL}/api/lessons`, payload);
      }

      setMessage({ type: 'success', text: lessonForm.id ? 'Lesson updated' : 'Lesson created' });
      setIsLessonModalOpen(false);
      setLessonForm(initialLessonForm);
      await fetchModulesAndLessons();
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to save lesson') });
    } finally {
      setIsSavingLesson(false);
    }
  }

  async function handleDeleteLesson(lessonId) {
    const confirmed = window.confirm('Delete this lesson?');
    if (!confirmed) return;

    try {
      await axios.delete(`${API_BASE_URL}/api/lessons/${lessonId}`);
      setMessage({ type: 'success', text: 'Lesson deleted' });
      await fetchModulesAndLessons();
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to delete lesson') });
    }
  }

  async function handleApiHealthCheck() {
    setMessage({ type: '', text: '' });
    try {
      await axios.get(`${API_BASE_URL}/health`);
      setApiHealth('Connected');
      setMessage({ type: 'success', text: 'API server is reachable' });
    } catch (error) {
      setApiHealth('Unavailable');
      setMessage({ type: 'error', text: formatError(error, 'API health check failed') });
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p>Course CMS</p>
          <h1>Master React Native Admin Panel</h1>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={`nav-item ${activePage === item ? 'active' : ''}`}
              onClick={() => setActivePage(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <small>API</small>
          <strong>{apiHealth}</strong>
          <p>{API_BASE_URL}</p>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Control Center v2</p>
            <h2>{activePage}</h2>
          </div>
          <button type="button" className="secondary compact-btn" onClick={() => refreshAllData(true)} disabled={isLoadingData}>
            {isLoadingData ? 'Syncing...' : 'Sync Now'}
          </button>
        </header>

        {message.text ? <div className={`message ${message.type}`}>{message.text}</div> : null}

        {activePage === 'Dashboard' ? (
          <section className="page-panel">
            <div className="kpi-grid">
              <article>
                <p>Modules</p>
                <strong>{modules.length}</strong>
              </article>
              <article>
                <p>Lessons</p>
                <strong>{totalLessons}</strong>
              </article>
            </div>

            <section className="card">
              <h3>Latest Lessons</h3>
              <ul className="list-clean">
                {latestLessons.length ? (
                  latestLessons.map((lessonItem) => (
                    <li key={lessonItem.id}>
                      <div>
                        <strong>{lessonItem.title}</strong>
                        <p>{moduleMap[lessonItem.module_id]?.title || 'Unknown module'}</p>
                      </div>
                      <span>{lessonItem.read_time} min</span>
                    </li>
                  ))
                ) : (
                  <li className="empty">No lessons created yet.</li>
                )}
              </ul>
            </section>
          </section>
        ) : null}

        {activePage === 'Modules' ? (
          <section className="page-panel">
            <section className="card">
              <div className="section-head">
                <h3>All Modules</h3>
                <button type="button" className="compact-btn" onClick={openCreateModuleModal}>Create Module</button>
              </div>

              <div className="list-controls">
                <input
                  placeholder="Search modules by title, description"
                  value={moduleQuery}
                  onChange={(event) => setModuleQuery(event.target.value)}
                />
                <select value={moduleSort} onChange={(event) => setModuleSort(event.target.value)}>
                  <option value="order-asc">Sort: Module Order</option>
                  <option value="title-asc">Sort: Title A-Z</option>
                  <option value="title-desc">Sort: Title Z-A</option>
                  <option value="lessons-desc">Sort: Most Lessons</option>
                  <option value="time-desc">Sort: Most Total Time</option>
                </select>
                <button
                  type="button"
                  className="ghost compact-btn"
                  onClick={() => {
                    setModuleQuery('');
                    setModuleSort('order-asc');
                  }}
                >
                  Reset
                </button>
              </div>

              <p className="list-summary">Showing {filteredModules.length} of {modules.length} modules</p>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Description</th>
                      <th>BG Color</th>
                      <th>Image URL</th>
                      <th>Lessons</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModules.length ? (
                      filteredModules.map((moduleItem) => (
                        <tr key={moduleItem.id}>
                          <td>{moduleItem.title}</td>
                          <td>{moduleItem.description || '-'}</td>
                          <td>
                            <div className="module-bg-cell">
                              <span
                                className="module-bg-swatch"
                                style={{ backgroundColor: normalizeHexColor(moduleItem.background_color) || '#61DAFB' }}
                                aria-hidden="true"
                              />
                              <small>{normalizeHexColor(moduleItem.background_color) || '#61DAFB'}</small>
                            </div>
                          </td>
                          <td>
                            {moduleItem.image_url ? (
                              <div className="module-icon-cell">
                                <img src={moduleItem.image_url} alt={`${moduleItem.title} visual`} />
                                <small>{moduleItem.image_url.slice(0, 42)}{moduleItem.image_url.length > 42 ? '...' : ''}</small>
                              </div>
                            ) : (
                              <small>-</small>
                            )}
                          </td>
                          <td>{moduleItem.lesson_count}</td>
                          <td className="actions">
                            <button type="button" onClick={() => openEditModuleModal(moduleItem)}>Edit</button>
                            <button type="button" className="danger" onClick={() => handleDeleteModule(moduleItem.id)}>Delete</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="empty">
                          {modules.length ? 'No modules match your search.' : 'No modules yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

        {activePage === 'Lessons' ? (
          <section className="page-panel">
            <section className="card">
              <div className="section-head">
                <h3>All Lessons</h3>
                <button type="button" className="compact-btn" onClick={openCreateLessonModal}>Create Lesson</button>
              </div>

              <p className="list-summary">Showing {orderedLessons.length} lessons in module/lesson order</p>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Title</th>
                      <th>Read Time</th>
                      <th>Preview</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedLessons.length ? (
                      orderedLessons.map((lessonItem) => (
                        <tr key={lessonItem.id}>
                          <td>{moduleMap[lessonItem.module_id]?.title || '-'}</td>
                          <td>{lessonItem.title}</td>
                          <td>{lessonItem.read_time == null ? '-' : `${lessonItem.read_time} min`}</td>
                          <td>
                            <small>
                              {lessonItem.description || (lessonItem.content ? `${lessonItem.content.slice(0, 60)}...` : '-')}
                            </small>
                          </td>
                          <td className="actions">
                            <button type="button" onClick={() => openEditLessonModal(lessonItem)}>Edit</button>
                            <button type="button" className="danger" onClick={() => handleDeleteLesson(lessonItem.id)}>Delete</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="empty">
                          No lessons yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

        {activePage === 'Settings' ? (
          <section className="page-panel">
            <section className="card">
              <h3>API Health Check</h3>
              <p>Test connection to backend API server</p>
              <button type="button" className="secondary compact-btn" onClick={handleApiHealthCheck}>
                Check API Health
              </button>
            </section>
          </section>
        ) : null}
      </main>

      {isModuleModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsModuleModalOpen(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <button
                type="button"
                className="modal-close"
                aria-label="Close module dialog"
                onClick={() => setIsModuleModalOpen(false)}
              >
                x
              </button>
              <h3>{moduleForm.id ? 'Edit Module' : 'Create Module'}</h3>
            </div>

            <form ref={moduleModalScrollRef} className="form-stack modal-scrollable" onSubmit={handleSaveModule}>
              <label className="field-row">
                <span>Module Title *</span>
                <input
                  required
                  placeholder="Enter module title"
                  value={moduleForm.title}
                  onChange={(event) => setModuleForm({ ...moduleForm, title: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Module Description</span>
                <textarea
                  rows="3"
                  placeholder="Enter module description (optional)"
                  value={moduleForm.description}
                  onChange={(event) => setModuleForm({ ...moduleForm, description: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Background Color (hex)</span>
                <div className="color-input-wrap">
                  <input
                    type="color"
                    value={normalizeHexColor(moduleForm.background_color) || '#61DAFB'}
                    onChange={(event) => setModuleForm({ ...moduleForm, background_color: event.target.value })}
                  />
                  <input
                    type="text"
                    placeholder="#61DAFB"
                    value={moduleForm.background_color}
                    onChange={(event) => setModuleForm({ ...moduleForm, background_color: event.target.value })}
                  />
                </div>
              </label>

              <div className="module-bg-preview">
                <span>Background Preview</span>
                <div
                  className="module-bg-preview-box"
                  style={{ backgroundColor: normalizeHexColor(moduleForm.background_color) || '#61DAFB' }}
                >
                  {normalizeHexColor(moduleForm.background_color) || '#61DAFB'}
                </div>
              </div>

              <label className="field-row">
                <span>Icon (emoji or name)</span>
                <input
                  placeholder="book, code, design, etc."
                  value={moduleForm.icon}
                  onChange={(event) => setModuleForm({ ...moduleForm, icon: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Image URL</span>
                <input
                  type="url"
                  placeholder="https://example.com/image.png"
                  value={moduleForm.image_url}
                  onChange={(event) => setModuleForm({ ...moduleForm, image_url: event.target.value })}
                />
              </label>

              {moduleForm.image_url.trim() ? (
                <div className="image-preview">
                  <span>Image Preview</span>
                  <img src={moduleForm.image_url} alt="Module preview" />
                </div>
              ) : null}

              <label className="field-row">
                <span>Module Order</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={moduleForm.order_index}
                  onChange={(event) => setModuleForm({ ...moduleForm, order_index: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Prerequisites</span>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    placeholder="Enter prerequisite"
                    value={modulePrerequisiteInput}
                    onChange={(event) => setModulePrerequisiteInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addPrerequisiteChip(modulePrerequisiteInput);
                      }
                    }}
                  />
                  <button type="button" className="secondary compact-btn" onClick={() => addPrerequisiteChip(modulePrerequisiteInput)}>
                    Add
                  </button>
                </div>
                <div className="chip-list">
                  {moduleForm.prerequisites.length ? (
                    moduleForm.prerequisites.map((chip) => (
                      <span className="chip" key={chip}>
                        {chip}
                        <button type="button" onClick={() => removePrerequisiteChip(chip)}>x</button>
                      </span>
                    ))
                  ) : (
                    <small className="empty">No prerequisites added.</small>
                  )}
                </div>
              </label>

              <button type="submit" className="compact-btn" disabled={isSavingModule}>
                {isSavingModule ? 'Saving...' : moduleForm.id ? 'Update Module' : 'Create Module'}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isLessonModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={closeLessonModal}>
          <section className="modal-card large" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <button
                type="button"
                className="modal-close"
                aria-label="Close lesson dialog"
                onClick={closeLessonModal}
              >
                x
              </button>
              <h3>{lessonForm.id ? 'Edit Lesson' : 'Create Lesson'}</h3>
            </div>

            <form ref={lessonModalScrollRef} className="form-stack modal-scrollable" onSubmit={handleSaveLesson}>
              <label className="field-row">
                <span>Select Module *</span>
                <select
                  required
                  value={lessonForm.module_id}
                  onChange={(event) => setLessonForm({ ...lessonForm, module_id: event.target.value })}
                >
                  <option value="">Select module</option>
                  {modules.map((moduleItem) => (
                    <option key={moduleItem.id} value={moduleItem.id}>
                      {moduleItem.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-row">
                <span>Lesson Title *</span>
                <input
                  required
                  placeholder="Enter lesson title"
                  value={lessonForm.title}
                  onChange={(event) => setLessonForm({ ...lessonForm, title: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Time Needed (minutes)</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Optional"
                  value={lessonForm.read_time}
                  onChange={(event) => setLessonForm({ ...lessonForm, read_time: event.target.value })}
                />
                <small className="field-hint">Optional. Leave empty if not needed.</small>
              </label>

              <label className="field-row">
                <span>Lesson Order</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={lessonForm.lesson_order}
                  onChange={(event) => setLessonForm({ ...lessonForm, lesson_order: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Lesson Description</span>
                <textarea
                  rows="2"
                  placeholder="Short summary (optional)"
                  value={lessonForm.description}
                  onChange={(event) => setLessonForm({ ...lessonForm, description: event.target.value })}
                />
              </label>

              <details className="syntax-help">
                <summary>Formatting Guide: headings, paragraphs, bold, code snippets</summary>
                <p>You can write plain text, or use HTML tags like h2, p, strong, ul/li, and pre/code.</p>
                <div className="syntax-actions">
                  <button type="button" className="ghost compact-btn" onClick={() => appendLessonSnippet('<h2>Section Heading</h2>')}>+ Heading</button>
                  <button type="button" className="ghost compact-btn" onClick={() => appendLessonSnippet('<p>Your paragraph text goes here.</p>')}>+ Paragraph</button>
                  <button type="button" className="ghost compact-btn" onClick={() => appendLessonSnippet('<strong>Important bold text</strong>')}>+ Bold</button>
                  <button type="button" className="ghost compact-btn" onClick={() => appendLessonSnippet('<ul>\n  <li>Point one</li>\n  <li>Point two</li>\n</ul>')}>+ List</button>
                  <button type="button" className="ghost compact-btn" onClick={() => appendLessonSnippet('<pre><code>// Code here\nconst x = 1;\n</code></pre>')}>+ Code Block</button>
                </div>
                <pre>{lessonSyntaxTemplate}</pre>
                <button
                  type="button"
                  className="secondary compact-btn"
                  onClick={() => appendLessonSnippet(lessonSyntaxTemplate)}
                >
                  Insert Syntax Template
                </button>
              </details>

              <label className="field-row">
                <span>Lesson Content</span>
                <textarea
                  rows="10"
                  className="full-span lesson-content-input"
                  placeholder="Lesson content (supports long text and code snippets)"
                  value={lessonForm.content}
                  spellCheck={false}
                  onChange={(event) => setLessonForm({ ...lessonForm, content: event.target.value })}
                />
              </label>

              <section className="lesson-preview">
                <h4>Live Preview</h4>
                {lessonPreviewHtml ? (
                  <div
                    ref={lessonPreviewRef}
                    className="lesson-preview-content"
                    dangerouslySetInnerHTML={{ __html: lessonPreviewHtml }}
                  />
                ) : (
                  <p className="empty">Preview appears here when you add lesson content.</p>
                )}
              </section>

              <button type="submit" className="compact-btn" disabled={isSavingLesson}>
                {isSavingLesson ? 'Saving...' : lessonForm.id ? 'Update Lesson' : 'Create Lesson'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
