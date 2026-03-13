import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'https://master-react-native-backend-production.up.railway.app';

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
  id: null,
  title: '',
  description: '',
  prerequisites: '',
};

const initialAppContentForm = {
  welcome_title: '',
  welcome_description: '',
  motivation_text: '',
  motivation_quote: '',
};

function App() {
  const [modules, setModules] = useState([]);
  const [moduleForm, setModuleForm] = useState(initialModuleForm);
  const [appContentForm, setAppContentForm] = useState(initialAppContentForm);
  const [message, setMessage] = useState('');
  const [isLoadingModules, setIsLoadingModules] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [isSavingAppContent, setIsSavingAppContent] = useState(false);

  const orderedModules = useMemo(() => [...modules], [modules]);

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

  async function fetchModules() {
    setIsLoadingModules(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/modules`);
      const payload = response.data.data || [];
      setModules(payload);
    } finally {
      setIsLoadingModules(false);
    }
  }

  useEffect(() => {
    fetchModules().catch(() => setMessage('Failed to load modules'));
    fetchAppContent().catch(() => setMessage('Failed to load app content'));
  }, []);

  async function handleSaveAppContent(event) {
    event.preventDefault();
    setMessage('');
    setIsSavingAppContent(true);

    try {
      await axios.put(`${API_BASE_URL}/api/app-content`, appContentForm);
      setMessage('App content updated');
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to update app content');
    } finally {
      setIsSavingAppContent(false);
    }
  }

  async function handleCreateModule(event) {
    event.preventDefault();
    setMessage('');
    setIsSavingModule(true);

    try {
      const payload = {
        title: moduleForm.title,
        description: moduleForm.description,
        prerequisites: moduleForm.prerequisites,
      };

      if (moduleForm.id) {
        await axios.put(`${API_BASE_URL}/api/modules/${moduleForm.id}`, payload);
      } else {
        await axios.post(`${API_BASE_URL}/api/modules`, payload);
      }

      setModuleForm(initialModuleForm);
      await fetchModules();
      setMessage(moduleForm.id ? 'Module updated' : 'Module created');
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to save module');
    } finally {
      setIsSavingModule(false);
    }
  }

  function handleEditModule(moduleItem) {
    setModuleForm({
      id: moduleItem.id,
      title: moduleItem.title,
      description: moduleItem.description || '',
      prerequisites: moduleItem.prerequisites || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDeleteModule(moduleId) {
    const confirmed = window.confirm('Delete this module and all its lessons?');
    if (!confirmed) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/api/modules/${moduleId}`);
      setMessage('Module deleted');
      await fetchModules();

      if (moduleForm.id === moduleId) {
        setModuleForm(initialModuleForm);
      }
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Failed to delete module');
    }
  }


  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Course CMS</p>
          <h1>Master React Native Admin</h1>
          <p className="hero-subtitle">Task 1: create modules and sync them to the mobile app.</p>
        </div>
        <div className="stats-grid">
          <article>
            <span>Modules</span>
            <strong>{modules.length}</strong>
          </article>
        </div>
      </header>

      {message && <div className="message">{message}</div>}

      <section className="card">
        <h2>App Home Content</h2>
        <form className="form-grid" onSubmit={handleSaveAppContent}>
          <input
            required
            placeholder="Welcome title"
            value={appContentForm.welcome_title}
            onChange={(e) => setAppContentForm({ ...appContentForm, welcome_title: e.target.value })}
          />
          <input
            required
            placeholder="Welcome description"
            value={appContentForm.welcome_description}
            onChange={(e) => setAppContentForm({ ...appContentForm, welcome_description: e.target.value })}
          />
          <input
            required
            placeholder="Motivation title"
            value={appContentForm.motivation_text}
            onChange={(e) => setAppContentForm({ ...appContentForm, motivation_text: e.target.value })}
          />
          <textarea
            required
            rows="3"
            placeholder="Motivation quote"
            value={appContentForm.motivation_quote}
            onChange={(e) => setAppContentForm({ ...appContentForm, motivation_quote: e.target.value })}
          />
          <button type="submit" disabled={isSavingAppContent}>
            {isSavingAppContent ? 'Saving...' : 'Save Home Content'}
          </button>
        </form>
      </section>

      <div className="layout">
        <section className="card">
          <h2>{moduleForm.id ? 'Edit Module' : 'Create Module'}</h2>
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
            <input
              placeholder="Prerequisites (comma separated)"
              value={moduleForm.prerequisites}
              onChange={(e) => setModuleForm({ ...moduleForm, prerequisites: e.target.value })}
            />
            <button type="submit" disabled={isSavingModule}>
              {isSavingModule ? 'Saving...' : moduleForm.id ? 'Update Module' : 'Create Module'}
            </button>
            {moduleForm.id ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setModuleForm(initialModuleForm)}
              >
                Cancel Edit
              </button>
            ) : null}
          </form>
        </section>

        <section className="card">
          <h2>Notes</h2>
          <ol className="steps">
            <li>Use prerequisites in comma format: `state, hooks, api`.</li>
            <li>Home content updates are shown in mobile Home screen.</li>
            <li>Modules list in mobile shows lesson count and total minutes.</li>
          </ol>
        </section>
      </div>

      <section className="card">
        <h2>Current Modules</h2>
        {isLoadingModules ? <p>Loading modules...</p> : null}
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Icon</th>
                <th>Title</th>
                <th>Description</th>
                <th>Prerequisites</th>
                <th>Lessons</th>
                <th>Total Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orderedModules.length ? (
                orderedModules.map((module) => (
                  <tr key={module.id}>
                    <td>{getIconEmoji(module.icon)}</td>
                    <td>{module.title}</td>
                    <td>{module.description || 'No description'}</td>
                    <td>{module.prerequisites || '-'}</td>
                    <td>{module.lesson_count}</td>
                    <td>{module.total_read_time} min</td>
                    <td className="actions">
                      <button type="button" onClick={() => handleEditModule(module)}>
                        Edit
                      </button>
                      <button type="button" className="danger" onClick={() => handleDeleteModule(module.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="empty">No modules yet. Create your first one above.</td>
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
