// --- CONFIGURATION ---
const SUPABASE_URL = 'https://epklfzbvlqzarptpwsdn.supabase.co'; // ЗАМЕНИТЬ!
const SUPABASE_ANON_KEY = 'sb_publishable_aa5ojwVrZ7pfLE0ec0DV5w_p3Zk2fcn'; // ЗАМЕНИТЬ!

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUserProfile = null;
let currentChannelSubscription = null; // For realtime chat
let activeRoomId = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await checkSession();
});

function setupEventListeners() {
    // Auth Forms
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('form-register').addEventListener('submit', handleRegister);
    
    // Navigation Tabs
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab));
    });

    // Search Inputs
    document.getElementById('global-search').addEventListener('input', debounce(filterChats, 300));
    document.getElementById('contact-search').addEventListener('input', debounce(filterContacts, 300));

    // File Uploads
    document.getElementById('avatar-upload').addEventListener('change', uploadAvatar);
    document.getElementById('file-upload').addEventListener('change', uploadMediaMessage);

    // Theme Controls
    document.getElementById('dark-mode-toggle').addEventListener('change', toggleDarkMode);
    document.getElementById('theme-color-select').addEventListener('change', changeThemeColor);
}

async function checkSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (session) {
        await loadUserProfile(session.user.id);
    } else {
        showView('view-auth');
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            location.reload();
        }
    });
}

function showView(viewId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('form-login');
    const regForm = document.getElementById('form-register');
    const tabs = document.querySelectorAll('.tab-btn');
    
    tabs.forEach(t => t.classList.remove('active'));
    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
        tabs[0].classList.add('active');
    } else {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
        tabs[1].classList.add('active');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = e.target[0].value;
    const password = e.target[1].value;
    
    try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Session will be picked up by onAuthStateChange or next reload logic
        // But let's force load profile immediately
        const { data: { session } } = await supabase.auth.getSession();
        if(session) await loadUserProfile(session.user.id);
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value;
    const email = e.target[1].value; // Second input is email
    const password = e.target[2].value; // Third input is password
    
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { username: username }
            }
        });
        if (error) throw error;
        
        // Create Profile in DB
        await createInitialProfile(data.user.id, username);
        
        // Auto Login
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (!signInError) {
             const { data: { session } } = await supabase.auth.getSession();
             if(session) await loadUserProfile(session.user.id);
        }
    } catch (err) {
        alert(err.message);
    }
}

async function createInitialProfile(userId, username) {
    const { error } = await supabase.from('xsoc_profiles').insert([{
        id: userId,
        username: username,
        full_name: username,
        phone_number: null,
        theme_color: '#007bff',
        is_dark_mode: false
    }]);
    if (error) console.error("Profile creation failed:", error);
}

async function loadUserProfile(userId) {
    const loader = document.getElementById('loader-profile');
    loader.classList.remove('hidden');
    
    try {
        const { data, error } = await supabase
            .from('xsoc_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            // Should not happen if registration worked, but fallback
            await createInitialProfile(userId, 'User'+Math.floor(Math.random()*1000));
            return loadUserProfile(userId);
        }

        currentUserProfile = data;
        applyThemeSettings(data);
        renderAppUI(data);
        await fetchAndRenderChats();
        await fetchAndRenderContacts();
        
        showView('view-app');
    } catch (err) {
        alert("Ошибка загрузки профиля: " + err.message);
    } finally {
        loader.classList.add('hidden');
    }
}

function applyThemeSettings(profile) {
    if (profile.is_dark_mode) document.body.classList.add('dark-theme');
    else document.body.classList.remove('dark-theme');
    
    document.documentElement.style.setProperty('--primary', profile.theme_color);
    document.getElementById('dark-mode-toggle').checked = profile.is_dark_mode;
    document.getElementById('theme-color-select').value = profile.theme_color;
}

function renderAppUI(profile) {
    document.getElementById('my-fullname').textContent = profile.full_name || profile.username;
    document.getElementById('my-phone').textContent = profile.phone_number || 'Не указан';
    if(profile.avatar_url) document.getElementById('my-avatar-img').src = profile.avatar_url;
    else document.getElementById('my-avatar-img').alt = profile.username.charAt(0).toUpperCase();
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');
    
    if(tabId === 'tab-chats-list') fetchAndRenderChats();
    if(tabId === 'tab-contacts') fetchAndRenderContacts();
}
// --- CHAT LOGIC ---

async function fetchAndRenderChats(searchTerm = '') {
    const { data: rooms, error } = await supabase
        .from('xsoc_rooms')
        .select('*, xsoc_members(user_id, role)')
        .order('created_at', { ascending: false });

    if (error) { console.error(error); return; }

    const ul = document.getElementById('chat-list-ul');
    ul.innerHTML = '';

    rooms.forEach(room => {
        // Check if user is member
        const isMember = room.xsoc_members.some(m => m.user_id === currentUserProfile.id);
        const isPublicChannel = room.kind === 'channel_pub';
        
        if (!isMember && !isPublicChannel) return; // Hide private non-member chats

        if (searchTerm && !room.name.toLowerCase().includes(searchTerm.toLowerCase())) return;

        const li = document.createElement('li');
        li.className = 'list-item';
        li.onclick = () => openChatRoom(room.room_id, room.name, room.avatar_url, room.kind);
        
        // Get last message preview (optional optimization: join with messages table later)
        li.innerHTML = `
            <div class="avatar-sm">${room.avatar_url ? `<img src="${room.avatar_url}" style="width:100%;height:100%;border-radius:50%">` : room.name.charAt(0)}</div>
            <div class="item-details">
                <div class="item-title">${room.name}</div>
                <div class="item-sub">${getKindLabel(room.kind)}</div>
            </div>
        `;
        ul.appendChild(li);
    });
}

function getKindLabel(kind) {
    switch(kind) {
        case 'dm': return 'Личный чат';
        case 'group': return 'Группа';
        case 'channel_pub': return 'Публичный канал';
        case 'channel_priv': return 'Закрытый канал';
        default: return '';
    }
}

async function openChatRoom(roomId, name, avatarUrl, kind) {
    activeRoomId = roomId;
    document.getElementById('active-chat-name').textContent = name;
    document.getElementById('active-chat-avatar').src = avatarUrl || '';
    document.getElementById('tab-chat-view').classList.remove('hidden');
    document.getElementById('tab-chats-list').classList.add('hidden');
    
    // Load History
    const { data: msgs, error } = await supabase
        .from('xsoc_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('sent_at', { ascending: true });
        
    if(msgs) renderMessages(msgs);

    // Subscribe to Realtime
    subscribeToRoom(roomId, kind);
}

function closeActiveChat() {
    activeRoomId = null;
    if(currentChannelSubscription) {
        supabase.removeChannel(currentChannelSubscription);
        currentChannelSubscription = null;
    }
    document.getElementById('tab-chat-view').classList.add('hidden');
    document.getElementById('tab-chats-list').classList.remove('hidden');
}

function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    messages.forEach(msg => appendMessageDOM(msg));
    container.scrollTop = container.scrollHeight;
}

function appendMessageDOM(msg) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    const isMine = msg.sender_id === currentUserProfile.id;
    div.className = `msg-bubble ${isMine ? 'msg-mine' : ''}`;
    
    let contentHtml = '';
    if (msg.media_type === 'image') contentHtml = `<img src="${msg.content}" style="max-width:100%; border-radius:10px;">`;
    else if (msg.media_type === 'audio') contentHtml = `<audio controls src="${msg.content}"></audio>`;
    else if (msg.media_type === 'video') contentHtml = `<video controls src="${msg.content}" style="max-width:100%; border-radius:10px;"></video>`;
    else contentHtml = escapeHtml(msg.content);

    div.innerHTML = `${contentHtml}<br><small>${new Date(msg.sent_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function subscribeToRoom(roomId, kind) {
    if(currentChannelSubscription) supabase.removeChannel(currentChannelSubscription);
    
    // Filter strictly by room_id to prevent leaks
    currentChannelSubscription = supabase.channel(`room_${roomId}`)
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'xsoc_messages',
            filter: `room_id=eq.${roomId}` 
        }, payload => {
            if(payload.eventType === 'INSERT') {
                appendMessageDOM(payload.new);
            }
        })
        .subscribe(status => {
            if(status === 'SUBSCRIBED') console.log('Connected to chat realtime');
        });
}

async function sendMessage() {
    if(!activeRoomId) return;
    const textarea = document.getElementById('msg-textarea');
    const text = textarea.value.trim();
    if(!text) return;

    // Determine permissions based on Room Kind
    // Simplified: Assume user can send if they are here. 
    // In production, check 'role' from members table first.
    
    const { error } = await supabase.from('xsoc_messages').insert([{
        room_id: activeRoomId,
        sender_id: currentUserProfile.id,
        content: text,
        media_type: 'text'
    }]);

    if(error) alert("Ошибка отправки: " + error.message);
    else textarea.value = '';
}

async function uploadMediaMessage(e) {
    const file = e.target.files[0];
    if(!file || !activeRoomId) return;
    
    const ext = file.name.split('.').pop();
    const path = `${currentUserProfile.id}/${Date.now()}.${ext}`;
    
    // Upload to Storage bucket 'xsoc-media' (Must create this bucket in Supabase Dashboard!)
    const { data, error } = await supabase.storage.from('xsoc-media').upload(path, file);
    if(error) { alert("Upload failed"); return; }

    const publicUrl = supabase.storage.from('xsoc-media').getPublicUrl(data.path).data.publicUrl;
    
    let type = 'image';
    if(file.type.startsWith('video')) type = 'video';
    if(file.type.startsWith('audio')) type = 'audio';

    await supabase.from('xsoc_messages').insert([{
        room_id: activeRoomId,
        sender_id: currentUserProfile.id,
        content: publicUrl,
        media_type: type
    }]);
    
    e.target.value = ''; // Reset input
}

function triggerFileInput() {
    document.getElementById('file-upload').click();
}
// --- CONTACTS LOGIC ---

async function fetchAndRenderContacts(searchTerm = '') {
    const { data: contacts, error } = await supabase
        .from('xsoc_contacts')
        .select('target_id, xsoc_profiles(*)')
        .eq('owner_id', currentUserProfile.id);

    if (error) { console.error(error); return; }

    const ul = document.getElementById('contact-list-ul');
    ul.innerHTML = '';

    contacts.forEach(c => {
        const prof = c.xsoc_profiles;
        if(searchTerm && !prof.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) && !prof.username?.toLowerCase().includes(searchTerm.toLowerCase())) return;

        const li = document.createElement('li');
        li.className = 'list-item';
        li.innerHTML = `
            <div class="avatar-sm">${prof.avatar_url ? `<img src="${prof.avatar_url}" style="width:100%;height:100%;border-radius:50%">` : prof.username.charAt(0)}</div>
            <div class="item-details">
                <div class="item-title">${prof.full_name || prof.username}</div>
                <div class="item-sub">${prof.phone_number || 'No Phone'}</div>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="icon-btn" onclick="startCall('${prof.id}', '${prof.username}')">📞</button>
                <button class="icon-btn" onclick="createDM('${prof.id}', '${prof.username}')">💬</button>
            </div>
        `;
        ul.appendChild(li);
    });
}

async function createDM(targetUserId, targetName) {
    // Check if DM exists
    const { data: existing } = await supabase.from('xsoc_rooms').select('*').eq('kind', 'dm');
    // Note: Proper DM logic requires checking participants. Simplified here: Always create new or find existing pair.
    // For brevity, we'll just insert a new room named after the user. 
    
    const { data, error } = await supabase.from('xsoc_rooms').insert([{
        kind: 'dm',
        name: targetName,
        creator_id: currentUserProfile.id,
        is_public: false
    }]).select().single();

    if(error) { alert(error.message); return; }
    
    // Add other user as member
    await supabase.from('xsoc_members').insert([
        { room_id: data.room_id, user_id: currentUserProfile.id, role: 'admin' },
        { room_id: data.room_id, user_id: targetUserId, role: 'member' }
    ]);
    
    openChatRoom(data.room_id, targetName, '', 'dm');
}

function startCall(receiverId, receiverName) {
    // Simple simulation of call initiation via logging
    alert(`Звонок ${receiverName}...\n(WebRTC signaling would go here)`);
    supabase.from('xsoc_calls_log').insert([{
        caller_id: currentUserProfile.id,
        receiver_id: receiverId,
        status: 'missed' // Placeholder
    }]);
}

// --- SETTINGS & UTILS ---

function toggleDarkMode(e) {
    const isDark = e.target.checked;
    document.body.classList.toggle('dark-theme', isDark);
    updateProfileField('is_dark_mode', isDark);
}

function changeThemeColor(e) {
    const color = e.target.value;
    document.documentElement.style.setProperty('--primary', color);
    updateProfileField('theme_color', color);
}

async function updateProfileField(field, value) {
    await supabase.from('xsoc_profiles').update({ [field]: value }).eq('id', currentUserProfile.id);
}

async function uploadAvatar(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    const path = `avatars/${currentUserProfile.id}.jpg`;
    const { data, error } = await supabase.storage.from('xsoc-media').upload(path, file, { cacheControl: '3600', upsert: true });
    if(error) { alert(error.message); return; }

    const url = supabase.storage.from('xsoc-media').getPublicUrl(path).data.publicUrl;
    await updateProfileField('avatar_url', url);
    document.getElementById('my-avatar-img').src = url;
}

function logout() {
    supabase.auth.signOut();
}

function deleteAccountConfirm() {
    if(confirm("Вы уверены? Все данные будут удалены навсегда.")) {
        // In real app, you'd need an Edge Function to delete auth user safely.
        // Here we just delete profile and rely on cascade.
        supabase.from('xsoc_profiles').delete().eq('id', currentUserProfile.id).then(() => {
            supabase.auth.signOut();
        });
    }
}

function changePasswordPrompt() {
    const newPass = prompt("Новый пароль:");
    if(newPass) {
        supabase.auth.updateUser({ password: newPass }).then(({error}) => {
            if(error) alert(error.message);
            else alert("Пароль изменен!");
        });
    }
}

function changePhonePrompt() {
    const newPhone = prompt("Новый номер телефона:");
    if(newPhone) updateProfileField('phone_number', newPhone);
}

// Helper Functions
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function filterChats(e) { fetchAndRenderChats(e.target.value); }
function filterContacts(e) { fetchAndRenderContacts(e.target.value); }

function openCreateRoomModal() {
    const modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML = `
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">×</span>
            <h3>Новая комната</h3>
            <select id="new-room-kind">
                <option value="group">Группа</option>
                <option value="channel_pub">Публичный Канал</option>
                <option value="channel_priv">Закрытый Канал</option>
            </select>
            <input type="text" id="new-room-name" placeholder="Название">
            <button onclick="createNewRoom()">Создать</button>
        </div>
    `;
    modalRoot.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-root').classList.add('hidden');
}

async function createNewRoom() {
    const kind = document.getElementById('new-room-kind').value;
    const name = document.getElementById('new-room-name').value;
    if(!name) return alert("Введите название");

    const { data, error } = await supabase.from('xsoc_rooms').insert([{
        kind: kind,
        name: name,
        creator_id: currentUserProfile.id,
        is_public: kind === 'channel_pub'
    }]).select().single();

    if(error) { alert(error.message); return; }
    
    closeModal();
    fetchAndRenderChats();
}
