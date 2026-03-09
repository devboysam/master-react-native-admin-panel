import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const ICON_CHOICES = [
  { value: 'book', label: 'Book', emoji: '📘' },
  { value: 'code', label: 'Code', emoji: '💻' },
  { value: 'design', label: 'Design', emoji: '🎨' },
  { value: 'video', label: 'Video', emoji: '🎬' },
  { value: 'quiz', label: 'Quiz', emoji: '🧠' },
  { value: 'project', label: 'Project', emoji: '🛠️' },
];

function getIconEmoji(icon) {
  const match = ICON_CHOICES.find((item) => item.value === icon);
  return match?.emoji || '📁';
}

const initialModuleForm = {
  title: '',
  description: '',
  icon: 'book',
  order_index: 0,
};

const initialLessonForm = {
  module_id: '',
  title: '',
  content: '',
  read_time: 5,
  lesson_order: 0,
};

function App() {
  const [modules, setModules] = useState([]);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [lessons, setLessons] = useState([]);
  const [moduleForm, setModuleForm] = useState(initialModuleForm);
  const [lessonForm, setLessonForm] = useState(initialLessonForm);
  const [editingLessonId, setEditingLessonId] = useState(null);
  const [message, setMessage] = useState('');
  const [isLoadingModules, setIsLoadingModules] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [isSavingLesson, setIsSavingLesson] = useState(false);

  const selectedModule = useMemo(
    () => modules.find((item) => item.id === Number(selectedModuleId)),
    [modules, selectedModuleId]
  );

  async function fetchModules() {
    setIsLoadingModules(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/modules`);
      const payload = response.data.data || [];
      setModules(payload);

      if (payload.length && !selectedModuleId) {
        setSelectedModuleId(String(payload[0].id));
      }
    } finally {
      setIsLoadingModules(false);
    }
  }

  async function fetchLessons(moduleId) {
    if (!moduleId) {
      setLessons([]);
      return;
    }

    const response = await axios.get(`${API_BASE_URL}/api/modules/${moduleId}/lessons`);
    setLessons(response.data.data || []);
  }

  useEffect(() => {
    fetchModules().catch(() => setMessage('Failed to load modules'));
  }, []);

  useEffect(() => {
    fetchLessons(selectedModuleId).catch(() => setMessage('Failed to load lessons'));
  }, [selectedModuleId]);

  async function handleCreateModule(event) {
    event.preventDefault();
    setMessage('');
    setIsSavingModule(true);

    try {
      await axios.post(`${API_BASE_URL}/api/modules`, {
        ...moduleForm,
        order_index: Number(moduleForm.order_index),
      });
      setModuleForm(initialModuleForm);
      await fetchModules();
      setMessage('Module created');
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to create module');
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleSaveLesson(event) {
    event.preventDefault();
    setMessage('');

    const payload = {
      ...lessonForm,
      module_id: Number(lessonForm.module_id),
      read_time: Number(lessonForm.read_time),
      lesson_order: Number(lessonForm.lesson_order),
    };

    if (Number.isNaN(payload.module_id)) {
      setMessage('Please select a valid module');
      return;
    }

    setIsSavingLesson(true);

    try {
      if (editingLessonId) {
        await axios.put(`${API_BASE_URL}/api/lessons/${editingLessonId}`, payload);
        setMessage('Lesson updated');
      } else {
        await axios.post(`${API_BASE_URL}/api/lessons`, payload);
        setMessage('Lesson created');
      }

      setLessonForm({ ...initialLessonForm, module_id: selectedModuleId || '' });
      setEditingLessonId(null);
      await fetchLessons(selectedModuleId || payload.module_id);
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to save lesson');
    } finally {
      setIsSavingLesson(false);
    }
  }

  async function handleDeleteLesson(lessonId) {
    if (!window.confirm('Delete this lesson?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/api/lessons/${lessonId}`);
      setMessage('Lesson deleted');
      await fetchLessons(selectedModuleId);
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to delete lesson');
    }
  }

  async function handleEditLesson(lessonSummary) {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/lessons/${lessonSummary.id}`);
      const lesson = response.data.data;

      setEditingLessonId(lesson.id);
      setLessonForm({
        module_id: String(lesson.module_id),
        title: lesson.title,
        content: lesson.content || '',
        read_time: lesson.read_time,
        lesson_order: lesson.lesson_order,
      });
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to load lesson details');
    }
  }

  useEffect(() => {
    if (!editingLessonId) {
      setLessonForm((prev) => ({ ...prev, module_id: selectedModuleId || prev.module_id }));
    }
  }, [selectedModuleId, editingLessonId]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Course CMS</p>
          <h1>Learning Platform Admin</h1>
          <p className="hero-subtitle">Create modules, write lessons, and publish updates to your mobile app.</p>
        </div>
        <div className="stats-grid">
          <article>
            <span>Modules</span>
            <strong>{modules.length}</strong>
          </article>
          <article>
            <span>Lessons</span>
            <strong>{lessons.length}</strong>
          </article>
        </div>
      </header>

      {message && <div className="message">{message}</div>}

      <div className="layout">
        <section className="card">
          <h2>Create Module</h2>
          <form className="form-grid" onSubmit={handleCreateModule}>
            <input
              required
              placeholder="Title"
              value={moduleForm.title}
              onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })}
            />
            <input
              placeholder="Description"
              value={moduleForm.description}
              onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })}
            />
            <select
              value={moduleForm.icon}
              onChange={(e) => setModuleForm({ ...moduleForm, icon: e.target.value })}
            >
              {ICON_CHOICES.map((icon) => (
                <option key={icon.value} value={icon.value}>
                  {icon.emoji} {icon.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Order"
              value={moduleForm.order_index}
              onChange={(e) => setModuleForm({ ...moduleForm, order_index: e.target.value })}
            />
            <button type="submit" disabled={isSavingModule}>
              {isSavingModule ? 'Saving...' : 'Create Module'}
            </button>
          </form>
        </section>

        <section className="card">
          <h2>Dashboard</h2>
          <label className="module-picker">
            Select module
            <select value={selectedModuleId} onChange={(e) => setSelectedModuleId(e.target.value)}>
              <option value="">Choose a module</option>
              {modules.map((module) => (
                <option key={module.id} value={module.id}>
                  {getIconEmoji(module.icon)} {module.title}
                </option>
              ))}
            </select>
          </label>

          {isLoadingModules ? <p>Loading modules...</p> : null}

          {selectedModule ? (
            <div className="module-meta">
              <strong>
                <span>{getIconEmoji(selectedModule.icon)}</span> {selectedModule.title}
              </strong>
              <span>{selectedModule.description || 'No description yet'}</span>
              <small>Display order: {selectedModule.order_index}</small>
            </div>
          ) : (
            <p className="empty">Create your first module to begin.</p>
          )}
        </section>
      </div>

      <section className="card">
        <h2>{editingLessonId ? 'Edit Lesson' : 'Create Lesson'}</h2>
        <form className="form-grid" onSubmit={handleSaveLesson}>
          <select
            required
            value={lessonForm.module_id}
            onChange={(e) => setLessonForm({ ...lessonForm, module_id: e.target.value })}
          >
            <option value="">Select module</option>
            {modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.title}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Lesson title"
            value={lessonForm.title}
            onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
          />
          <textarea
            rows="6"
            placeholder="Lesson content"
            value={lessonForm.content}
            onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
          />
          <input
            type="number"
            placeholder="Read time (minutes)"
            value={lessonForm.read_time}
            onChange={(e) => setLessonForm({ ...lessonForm, read_time: e.target.value })}
          />
          <input
            type="number"
            placeholder="Lesson order"
            value={lessonForm.lesson_order}
            onChange={(e) => setLessonForm({ ...lessonForm, lesson_order: e.target.value })}
          />
          <button type="submit" disabled={isSavingLesson}>
            {isSavingLesson ? 'Saving...' : editingLessonId ? 'Update Lesson' : 'Create Lesson'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Lessons {selectedModule ? `for ${selectedModule.title}` : ''}</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Read Time</th>
                <th>Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lessons.length ? (
                lessons.map((lesson) => (
                  <tr key={lesson.id}>
                    <td>{lesson.title}</td>
                    <td>{lesson.read_time} min</td>
                    <td>{lesson.lesson_order}</td>
                    <td className="actions">
                      <button type="button" onClick={() => handleEditLesson(lesson)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => handleDeleteLesson(lesson.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className="empty">No lessons found for this module yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default App;
