async function fetchUsersAndPersonalities() {
  try {
    // Fetch all users
    const usersRes = await fetch('/api/personalities/admin/users', { credentials: 'include' });
    if (!usersRes.ok) throw new Error('Failed to fetch users');
    const usersData = await usersRes.json();
    const users = usersData.users;

    // Fetch all personalities
    const persRes = await fetch('/api/personalities/admin/personalities', { credentials: 'include' });
    if (!persRes.ok) throw new Error('Failed to fetch personalities');
    const persData = await persRes.json();
    const personalities = persData.personalities;

    // Render table
    let html = '<table class="admin-table"><thead><tr><th>User</th><th>Email</th><th>Personality</th><th>Description</th><th>Default</th><th>Actions</th></tr></thead><tbody>';
    users.forEach(user => {
      const userPers = personalities.filter(p => p.user_id === user.id);
      if (userPers.length === 0) {
        html += `<tr><td>${user.display_name || user.id}</td><td>${user.email}</td><td colspan="4"><em>No personalities</em></td></tr>`;
      } else {
        userPers.forEach((p, idx) => {
          html += `<tr><td>${idx === 0 ? (user.display_name || user.id) : ''}</td><td>${idx === 0 ? user.email : ''}</td><td>${p.name}</td><td>${p.description || ''}</td><td>${p.is_default ? '✅' : ''}</td><td><button data-pid="${p.id}" class="edit-personality-btn">Edit</button> <button data-pid="${p.id}" class="delete-personality-btn">Delete</button></td></tr>`;
        });
      }
      // Add create form row
      html += `<tr><td colspan="6"><form class="create-personality-form" data-uid="${user.id}">
        <input type="text" name="name" placeholder="Name" required style="width:100px;">
        <input type="text" name="description" placeholder="Description" style="width:200px;">
        <input type="text" name="systemPrompt" placeholder="System Prompt" style="width:200px;">
        <button type="submit">Create Personality</button>
      </form></td></tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('adminPersonalityMgmt').innerHTML = html;

    // Attach create handlers
    document.querySelectorAll('.create-personality-form').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const userId = form.getAttribute('data-uid');
        const formData = new FormData(form);
        const payload = {
          userId,
          name: formData.get('name'),
          description: formData.get('description'),
          systemPrompt: formData.get('systemPrompt'),
          personalityTraits: [],
          backgroundInfo: {},
          avatarPrompt: ''
        };
        const res = await fetch('/api/personalities/admin/personalities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          fetchUsersAndPersonalities();
        } else {
          alert('Failed to create personality');
        }
      });
    });

    // Attach edit/delete handlers
    document.querySelectorAll('.edit-personality-btn').forEach(btn => {
      btn.addEventListener('click', () => editPersonality(btn.getAttribute('data-pid')));
    });
    document.querySelectorAll('.delete-personality-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this personality?')) return;
        const pid = btn.getAttribute('data-pid');
        const res = await fetch(`/api/personalities/admin/personalities/${pid}`, {
          method: 'DELETE', credentials: 'include'
        });
        if (res.ok) fetchUsersAndPersonalities();
        else alert('Failed to delete personality');
      });
    });
  } catch (err) {
    document.getElementById('adminPersonalityMgmt').textContent = 'Error loading personalities.';
  }
}

async function editPersonality(pid) {
  // Fetch personality details
  const res = await fetch(`/api/personalities/admin/personalities?user_id=`, { credentials: 'include' });
  if (!res.ok) return alert('Failed to fetch personality');
  const persData = await res.json();
  const p = persData.personalities.find(x => x.id == pid);
  if (!p) return alert('Personality not found');
  // Show simple prompt for editing (for demo; replace with modal for production)
  const newName = prompt('Edit name:', p.name);
  if (newName === null) return;
  const newDesc = prompt('Edit description:', p.description || '');
  if (newDesc === null) return;
  const newPrompt = prompt('Edit system prompt:', p.system_prompt || '');
  if (newPrompt === null) return;
  const payload = {
    name: newName,
    description: newDesc,
    systemPrompt: newPrompt,
    personalityTraits: p.personality_traits || [],
    backgroundInfo: p.background_info || {},
    avatarPrompt: p.avatar_prompt || ''
  };
  const updateRes = await fetch(`/api/personalities/admin/personalities/${pid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  if (updateRes.ok) fetchUsersAndPersonalities();
  else alert('Failed to update personality');
}
// Admin Dashboard Page for AI Chat App
// This page displays job queue, service status, and personality management for admins

// TODO: Implement real-time updates and admin-only access

import './css/admin.css';


async function fetchJobQueue() {
  try {
    const res = await fetch('/api/admin/job-queue', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch job queue');
    const data = await res.json();
    const html = `
      <ul>
        <li>Pending LLMs: <strong>${data.pending.llm}</strong></li>
        <li>Pending Images: <strong>${data.pending.image}</strong></li>
        <li>Pending Videos: <strong>${data.pending.video}</strong></li>
        <li>Other Pending: <strong>${data.pending.other}</strong></li>
        <li>Total in Queue: <strong>${data.queueLength}</strong></li>
        <li>Active Processes: <strong>${data.activeCount}</strong></li>
        <li>Current Active: <pre style="white-space:pre-wrap;">${data.active ? JSON.stringify(data.active, null, 2) : 'None'}</pre></li>
      </ul>
    `;
    document.getElementById('adminJobQueue').innerHTML = html;
  } catch (err) {
    document.getElementById('adminJobQueue').textContent = 'Error loading job queue.';
  }
}

async function fetchServiceStatus() {
  try {
    const res = await fetch('/api/services/health');
    if (!res.ok) throw new Error('Failed to fetch service status');
    const data = await res.json();
    const html = Object.entries(data.services).map(([name, svc]) =>
      `<li>${name.toUpperCase()}: <span class="${svc.status === 'online' ? 'admin-status-online' : 'admin-status-offline'}">${svc.status}</span> <small>(${svc.url})</small></li>`
    ).join('');
    document.getElementById('adminServiceStatus').innerHTML = `<ul>${html}</ul>`;
  } catch (err) {
    document.getElementById('adminServiceStatus').textContent = 'Error loading service status.';
  }
}

function startAdminDashboardPolling() {
  fetchJobQueue();
  fetchServiceStatus();
  setInterval(fetchJobQueue, 5000);
  setInterval(fetchServiceStatus, 10000);
}

window.addEventListener('DOMContentLoaded', () => {
  startAdminDashboardPolling();
  fetchUsersAndPersonalities();
});
