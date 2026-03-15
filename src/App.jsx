import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'https://master-react-native-backend-production.up.railway.app';

const NAV_ITEMS = ['Dashboard', 'Modules', 'Lessons', 'Settings'];

const initialModuleForm = {
  id: null,
  title: '',
  description: '',
  prerequisites: [],
  icon: 'book',
  image_url: '',
};

const initialLessonForm = {
  id: null,
  module_id: '',
  title: '',
  description: '',
  read_time: 5,
  content: '',
};

const lessonSyntaxTemplate = `<h2>Section Heading</h2>
<p>This lesson supports <strong>bold text</strong>, paragraphs, and code blocks.</p>

<pre><code>import React from 'react';
import { View, Text } from 'react-native';

export default function Example() {
  return <Text>Hello React Native</Text>;
}</code></pre>`;

const initialAppContentForm = {
  welcome_title: '',
  welcome_description: '',
  motivation_text: '',
  motivation_quote: '',
};

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

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
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
  const [moduleForm, setModuleForm] = useState(initialModuleForm);
  const [lessonForm, setLessonForm] = useState(initialLessonForm);
  const [appContentForm, setAppContentForm] = useState(initialAppContentForm);
  const [modulePrerequisiteInput, setModulePrerequisiteInput] = useState('');
  const [isModuleModalOpen, setIsModuleModalOpen] = useState(false);
  const [isLessonModalOpen, setIsLessonModalOpen] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [isSavingAppContent, setIsSavingAppContent] = useState(false);
  const [apiHealth, setApiHealth] = useState('Unknown');
  const lessonPreviewRef = useRef(null);

  const totalLessons = lessons.length;
  const totalMinutes = modules.reduce((sum, moduleItem) => sum + Number(moduleItem.total_read_time || 0), 0);

  const moduleMap = useMemo(() => {
    return modules.reduce((accumulator, moduleItem) => {
      accumulator[moduleItem.id] = moduleItem;
      return accumulator;
    }, {});
  }, [modules]);

  const latestLessons = lessons.slice(0, 6);
  const lessonPreviewHtml = useMemo(() => buildLessonPreviewHtml(lessonForm.content), [lessonForm.content]);

  useEffect(() => {
    if (!isLessonModalOpen || !lessonPreviewRef.current) {
      return;
    }

    lessonPreviewRef.current.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }, [isLessonModalOpen, lessonPreviewHtml]);

  async function fetchAppContent() {
    const response = await axios.get(`${API_BASE_URL}/api/app-content`);
    const payload = response.data.data;
    setAppContentForm({
      welcome_title: payload?.welcome_title || '',
      welcome_description: payload?.welcome_description || '',
      motivation_text: payload?.motivation_text || '',
      motivation_quote: payload?.motivation_quote || '',
    });
  }

  async function fetchModulesAndLessons() {
    const modulesResponse = await axios.get(`${API_BASE_URL}/api/modules`);
    const moduleRows = modulesResponse.data.data || [];
    setModules(moduleRows);

    if (!moduleRows.length) {
      setLessons([]);
      return;
    }

    const lessonRequests = moduleRows.map((moduleItem) =>
      axios
        .get(`${API_BASE_URL}/api/modules/${moduleItem.id}/lessons`)
        .then((response) => response.data.data || [])
        .catch(() => [])
    );

    const groupedLessons = await Promise.all(lessonRequests);
    const mergedLessons = groupedLessons.flat().sort((a, b) => {
      if (Number(a.module_id) !== Number(b.module_id)) {
        return Number(a.module_id) - Number(b.module_id);
      }
      if (Number(a.lesson_order) !== Number(b.lesson_order)) {
        return Number(a.lesson_order) - Number(b.lesson_order);
      }
      return Number(a.id) - Number(b.id);
    });

    setLessons(mergedLessons);
  }

  async function refreshAllData(showMessage = false) {
    setIsLoadingData(true);
    if (showMessage) {
      setMessage({ type: '', text: '' });
    }

    const [appContentResult, contentResult] = await Promise.allSettled([
      fetchAppContent(),
      fetchModulesAndLessons(),
    ]);

    const hasAppError = appContentResult.status === 'rejected';
    const hasContentError = contentResult.status === 'rejected';

    if (hasAppError || hasContentError) {
      setApiHealth('Unavailable');
      const reasons = [];

      if (hasAppError) {
        reasons.push(formatError(appContentResult.reason, 'Home content failed'));
      }
      if (hasContentError) {
        reasons.push(formatError(contentResult.reason, 'Modules/Lessons failed'));
      }

      setMessage({
        type: 'error',
        text: `Backend sync issue: ${reasons.join(' | ')}`,
      });
    } else {
      setApiHealth('Connected');
      if (showMessage) {
        setMessage({ type: 'success', text: 'Data synced successfully' });
      }
    }

    setIsLoadingData(false);
  }

  useEffect(() => {
    refreshAllData(false);
  }, []);

  function openCreateModuleModal() {
    setModuleForm(initialModuleForm);
    setModulePrerequisiteInput('');
    setIsModuleModalOpen(true);
  }

  function openEditModuleModal(moduleItem) {
    const iconValue = moduleItem.icon || 'book';
    const iconIsUrl = isHttpUrl(iconValue);
    setModuleForm({
      id: moduleItem.id,
      title: moduleItem.title || '',
      description: moduleItem.description || '',
      prerequisites: parsePrerequisites(moduleItem.prerequisites),
      icon: iconIsUrl ? 'book' : iconValue,
      image_url: iconIsUrl ? iconValue : '',
    });
    setModulePrerequisiteInput('');
    setIsModuleModalOpen(true);
  }

  function appendLessonSnippet(snippet) {
    setLessonForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content}\n\n${snippet}` : snippet,
    }));
  }

  function addPrerequisiteChip(value) {
    const chip = value.trim();
    if (!chip) {
      return;
    }

    setModuleForm((prev) => {
      if (prev.prerequisites.includes(chip)) {
        return prev;
      }
      return {
        ...prev,
        prerequisites: [...prev.prerequisites, chip],
      };
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
      const payload = {
        title: moduleForm.title,
        description: moduleForm.description,
        prerequisites: moduleForm.prerequisites.join(', '),
        icon: moduleForm.image_url?.trim() || moduleForm.icon,
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
    if (!confirmed) {
      return;
    }

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
    setIsLessonModalOpen(true);
  }

  async function openEditLessonModal(lessonItem) {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/lessons/${lessonItem.id}`);
      const fullLesson = response.data.data;
      setLessonForm({
        id: fullLesson.id,
        module_id: String(fullLesson.module_id),
        title: fullLesson.title || '',
        description: fullLesson.description || '',
        read_time: Number(fullLesson.read_time) || 5,
        content: fullLesson.content || '',
      });
      setIsLessonModalOpen(true);
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to load lesson details') });
    }
  }

  async function handleSaveLesson(event) {
    event.preventDefault();
    setIsSavingLesson(true);
    setMessage({ type: '', text: '' });

    try {
      const payload = {
        module_id: Number(lessonForm.module_id),
        title: lessonForm.title,
        description: lessonForm.description,
        content: lessonForm.content,
        read_time: Number(lessonForm.read_time) || 5,
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
    if (!confirmed) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/api/lessons/${lessonId}`);
      setMessage({ type: 'success', text: 'Lesson deleted' });
      await fetchModulesAndLessons();
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to delete lesson') });
    }
  }

  async function handleSaveAppContent(event) {
    event.preventDefault();
    setIsSavingAppContent(true);
    setMessage({ type: '', text: '' });

    try {
      await axios.put(`${API_BASE_URL}/api/app-content`, appContentForm);
      setMessage({ type: 'success', text: 'Home content updated' });
    } catch (error) {
      setMessage({ type: 'error', text: formatError(error, 'Failed to update home content') });
    } finally {
      setIsSavingAppContent(false);
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
            <p className="eyebrow">Control Center</p>
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
              <article>
                <p>Total Learning Time</p>
                <strong>{totalMinutes} min</strong>
              </article>
            </div>

            <div className="split">
              <section className="card">
                <h3>App Home Content</h3>
                <form className="form-grid" onSubmit={handleSaveAppContent}>
                  <input
                    required
                    placeholder="Welcome title"
                    value={appContentForm.welcome_title}
                    onChange={(event) =>
                      setAppContentForm({ ...appContentForm, welcome_title: event.target.value })
                    }
                  />
                  <input
                    required
                    placeholder="Welcome description"
                    value={appContentForm.welcome_description}
                    onChange={(event) =>
                      setAppContentForm({ ...appContentForm, welcome_description: event.target.value })
                    }
                  />
                  <input
                    required
                    placeholder="Motivation title"
                    value={appContentForm.motivation_text}
                    onChange={(event) =>
                      setAppContentForm({ ...appContentForm, motivation_text: event.target.value })
                    }
                  />
                  <textarea
                    required
                    rows="4"
                    placeholder="Motivation quote"
                    value={appContentForm.motivation_quote}
                    onChange={(event) =>
                      setAppContentForm({ ...appContentForm, motivation_quote: event.target.value })
                    }
                  />
                  <button type="submit" disabled={isSavingAppContent}>
                    {isSavingAppContent ? 'Saving...' : 'Save Home Content'}
                  </button>
                </form>
              </section>

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
            </div>
          </section>
        ) : null}

        {activePage === 'Modules' ? (
          <section className="page-panel">
            <section className="card">
              <div className="section-head">
                <h3>All Modules</h3>
                <button type="button" className="compact-btn" onClick={openCreateModuleModal}>Create Module</button>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Description</th>
                      <th>Icon / Image</th>
                      <th>Prerequisites</th>
                      <th>Lessons</th>
                      <th>Total Time</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.length ? (
                      modules.map((moduleItem) => (
                        <tr key={moduleItem.id}>
                          <td>{moduleItem.title}</td>
                          <td>{moduleItem.description || '-'}</td>
                          <td>
                            {isHttpUrl(moduleItem.icon) ? (
                              <div className="module-icon-cell">
                                <img src={moduleItem.icon} alt={moduleItem.title} />
                                <small>Image</small>
                              </div>
                            ) : (
                              moduleItem.icon || '-'
                            )}
                          </td>
                          <td>
                            {parsePrerequisites(moduleItem.prerequisites).length ? (
                              <div className="table-prereq-list">
                                {parsePrerequisites(moduleItem.prerequisites).map((item) => (
                                  <span key={`${moduleItem.id}-${item}`} className="table-prereq-chip">{item}</span>
                                ))}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{moduleItem.lesson_count}</td>
                          <td>{moduleItem.total_read_time} min</td>
                          <td className="actions">
                            <button type="button" onClick={() => openEditModuleModal(moduleItem)}>
                              Edit
                            </button>
                            <button type="button" className="danger" onClick={() => handleDeleteModule(moduleItem.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" className="empty">
                          No modules yet.
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
                    {lessons.length ? (
                      lessons.map((lessonItem) => (
                        <tr key={lessonItem.id}>
                          <td>{moduleMap[lessonItem.module_id]?.title || '-'}</td>
                          <td>{lessonItem.title}</td>
                          <td>{lessonItem.read_time} min</td>
                          <td>{lessonItem.description || lessonItem.content?.slice(0, 80) || '-'}</td>
                          <td className="actions">
                            <button type="button" onClick={() => openEditLessonModal(lessonItem)}>
                              Edit
                            </button>
                            <button type="button" className="danger" onClick={() => handleDeleteLesson(lessonItem.id)}>
                              Delete
                            </button>
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
              <h3>System Settings</h3>
              <div className="settings-grid">
                <article>
                  <h4>Backend API Endpoint</h4>
                  <p>{API_BASE_URL}</p>
                </article>
                <article>
                  <h4>Connection Status</h4>
                  <p>{apiHealth}</p>
                </article>
              </div>
              <div className="settings-actions">
                <button type="button" className="compact-btn" onClick={handleApiHealthCheck}>
                  Run API Health Check
                </button>
                <button type="button" className="secondary compact-btn" onClick={() => refreshAllData(true)}>
                  Sync Everything
                </button>
              </div>
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

            <form className="form-stack" onSubmit={handleSaveModule}>
              <label className="field-row">
                <span>Module Title</span>
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
                  rows="4"
                  placeholder="Enter module description"
                  value={moduleForm.description}
                  onChange={(event) => setModuleForm({ ...moduleForm, description: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Module Icon (name or emoji)</span>
                <input
                  placeholder="Example: book, code, react, ⚛️"
                  value={moduleForm.icon}
                  onChange={(event) => setModuleForm({ ...moduleForm, icon: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Module Image URL (optional)</span>
                <input
                  placeholder="https://.../module-image.png"
                  value={moduleForm.image_url}
                  onChange={(event) => setModuleForm({ ...moduleForm, image_url: event.target.value })}
                />
              </label>

              {isHttpUrl(moduleForm.image_url) ? (
                <div className="image-preview">
                  <span>Image Preview</span>
                  <img src={moduleForm.image_url.trim()} alt="Module preview" />
                </div>
              ) : null}

              <div className="chip-input-wrap">
                <label>Prerequisites</label>
                <div className="chip-input-row">
                  <input
                    placeholder="Type and press Enter"
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
                        <button type="button" onClick={() => removePrerequisiteChip(chip)}>
                          x
                        </button>
                      </span>
                    ))
                  ) : (
                    <small className="empty">No prerequisites added.</small>
                  )}
                </div>
              </div>

              <button type="submit" className="compact-btn" disabled={isSavingModule}>
                {isSavingModule ? 'Saving...' : moduleForm.id ? 'Update Module' : 'Create Module'}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isLessonModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setIsLessonModalOpen(false)}>
          <section className="modal-card large" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <button
                type="button"
                className="modal-close"
                aria-label="Close lesson dialog"
                onClick={() => setIsLessonModalOpen(false)}
              >
                x
              </button>
              <h3>{lessonForm.id ? 'Edit Lesson' : 'Create Lesson'}</h3>
            </div>

            <form className="form-stack" onSubmit={handleSaveLesson}>
              <label className="field-row">
                <span>Select Module</span>
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
                <span>Lesson Title</span>
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
                  min="1"
                  placeholder="Time needed"
                  value={lessonForm.read_time}
                  onChange={(event) => setLessonForm({ ...lessonForm, read_time: event.target.value })}
                />
              </label>

              <label className="field-row">
                <span>Lesson Description</span>
                <textarea
                  rows="3"
                  placeholder="Short summary shown in lesson list"
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
                  rows="14"
                  className="full-span"
                  placeholder="Lesson content (supports long text and code snippets)"
                  value={lessonForm.content}
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
