// ==========================================
// Xsocium Final Logic
// ==========================================

const SUPABASE_URL = 'https://epklfzbvlqzarptpwsdn.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_aa5ojwVrZ7pfLE0ec0DV5w_p3Zk2fcn'; 

let sb = null;
let currentUserProfile = null;
let activeRoomId = null;
let currentChannelSubscription = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof window.supabase === 'undefined') {
        alert("Ошибка: Библиотека Supabase не загрузилась.");
        return;
    }
    
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    setupEventListeners();
    await checkSession();
});

function setupEventListeners() {
    // Auth Tabs
    document.getElementById('tab-login-btn').onclick = () => switchAuthTab('login');
    document.getElementById('tab-reg-btn').onclick = () => switchAuthTab('register');
    
    // Forms
    document.getElementById('form-login').onsubmit = handleLogin;
    document.getElementById('form-register').onsubmit = handleRegister;
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const tabId = e.currentTarget.dataset.tab;
            if(tabId) switchMainTab(tabId);
        };
    });

    // Search
    document.getElementById('global-search').oninput = debounce(() => fetchAndRenderChats(document.getElementById('global-search').value), 300);
    document.getElementById('contact-search').oninput = debounce(() => fetchAndRenderContacts(document.getElementById('contact-search').value), 300);

    // Files & Settings
    document.getElementById('avatar-upload').onchange = uploadAvatar;
    document.getElementById('file-upload').onchange = uploadMediaMessage;
    document.getElementById('dark-mode-toggle').onchange = toggleDarkMode;
    document.getElementById('theme-color-select').onchange = changeThemeColor;
}

// --- AUTH LOGIC ---

async function checkSession() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (session) {
        await loadUserProfile(session.user.id);
    } else {
        showView('view-auth');
    }
    
    sb.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') location.reload();
    });
}

function showView(viewId) {
    console.log("Attempting to switch to view:", viewId);
    
    // 1. Скрываем ВСЕ экраны принудительно через style.display = 'none'
    document.querySelectorAll('.screen').forEach(el => {
        el.style.display = 'none';
        el.classList.add('hidden'); // Дублируем для надежности
    });

    // 2. Показываем нужный экран
    const target = document.getElementById(viewId);
    if(target) {
        target.style.display = 'flex'; // Используем flex, так как у нас колонки
        target.classList.remove('hidden');
        console.log("View switched successfully to:", viewId);
    } else {
        console.error("Target view element not found!", viewId);
    }
}

function switchAuthTab(tabName) {
    const loginForm = document.getElementById('form-login');
    const regForm = document.getElementById('form-register');
    const tabs = document.querySelectorAll('.tab-btn');
    
    tabs.forEach(t => t.classList.remove('active'));

    if (tabName === 'login') {
        loginForm.style.display = 'flex';
        regForm.style.display = 'none';
        document.getElementById('tab-login-btn').classList.add('active');
    } else {
        loginForm.style.display = 'none';
        regForm.style.display = 'flex';
        document.getElementById('tab-reg-btn').classList.add('active');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = e.target.querySelector('input[type="email"]').value;
    const pass = e.target.querySelector('input[type="password"]').value;
    
    try {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        
        const { data: { session } } = await sb.auth.getSession();
        if(session) await loadUserProfile(session.user.id);
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const inputs = e.target.querySelectorAll('input');
    const username = inputs[0].value.trim();
    const email = inputs[1].value.trim();
    const password = inputs[2].value;

    try {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
        if (error) throw error;
        
        if(data.user) {
            await createInitialProfile(data.user.id, username);
            // Auto login
            await sb.auth.signInWithPassword({ email, password });
            const { data: { session } } = await sb.auth.getSession();
            if(session) await loadUserProfile(session.user.id);
        }
    } catch (err) {
        alert(err.message);
    }
}

async function createInitialProfile(userId, username) {
    const { error } = await sb.from('xsoc_profiles').insert([{
        id: userId, username, full_name: username, phone_number: null, theme_color: '#007bff', is_dark_mode: false
    }]);
    if(error) console.error("Profile Insert Error:", error);
}

async function loadUserProfile(userId) {
    console.log("--- START LOAD PROFILE ---");
    const loader = document.getElementById('loader-profile');
    if(loader) loader.classList.remove('hidden');
    
    try {
        // 1. Запрос к базе
        console.log("Fetching profile for ID:", userId);
        const { data, error } = await sb
            .from('xsoc_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        // 2. Проверка ошибок запроса
        if (error) {
            console.error("DB Error fetching profile:", error);
            // Если ошибка "no rows found" (PGRST116), значит профиля нет. Создаем его.
            if (error.code === 'PGRST116') {
                console.warn("Profile not found. Creating new one...");
                await createInitialProfile(userId, 'User_' + Math.floor(Math.random()*1000));
                return loadUserProfile(userId); // Рекурсивный вызов для повторной попытки
            } else {
                throw error; // Другая ошибка (RLS, сеть и т.д.)
            }
        }

        // 3. Проверка данных
        if (!data) {
            console.error("Data is null/undefined despite no error!");
            throw new Error("Empty profile data");
        }

        console.log("Profile loaded successfully:", data.username);
        
        // 4. Применение настроек и рендер UI
        currentUserProfile = data;
        applyThemeSettings(data);
        renderAppUI(data);
        
        // 5. Загрузка чатов и контактов
        console.log("Loading chats and contacts...");
        await Promise.all([
            fetchAndRenderChats(),
            fetchAndRenderContacts()
        ]);
        
        // 6. Показ основного экрана
        console.log("Switching view to APP");
        showView('view-app');

    } catch (err) {
        console.error("CRITICAL ERROR in loadUserProfile:", err);
        alert("Не удалось загрузить профиль. Подробности в консоли.");
    } finally {
        if(loader) loader.classList.add('hidden');
        console.log("--- END LOAD PROFILE ---");
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
}

// --- NAVIGATION ---

function switchMainTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');
    
    if(tabId === 'tab-chats-list') fetchAndRenderChats();
    if(tabId === 'tab-contacts') fetchAndRenderContacts();
}

// --- CHAT LOGIC (SIMPLE QUERIES) ---

async function fetchAndRenderChats(searchTerm = '') {
    if(!currentUserProfile) return;
    const ul = document.getElementById('chat-list-ul');
    ul.innerHTML = '<li class="empty-msg">Загрузка...</li>';

    try {
        // 1. Получаем ТОЛЬКО свои записи об участии (благодаря новой политике Self Read Only)
        const { data: myMemberships, error: errMem } = await sb.from('xsoc_members').select('room_id').eq('user_id', currentUserProfile.id);
        
        if (errMem) throw errMem;
        
        if (!myMemberships || myMemberships.length === 0) {
            ul.innerHTML = '<li class="empty-msg">Нет активных чатов</li>';
            return;
        }

        const roomIds = myMemberships.map(m => m.room_id);

        // 2. Получаем детали этих комнат из таблицы xsoc_rooms
        // Здесь RLS для rooms должен позволять чтение, так как мы знаем ID комнат
        const { data: roomsDetails, error: errRooms } = await sb.from('xsoc_rooms').select('*').in('room_id', roomIds).order('created_at', { ascending: false });
        
        if (errRooms) throw errRooms;

        ul.innerHTML = '';
        roomsDetails.forEach(room => {
            if (searchTerm && !room.name.toLowerCase().includes(searchTerm.toLowerCase())) return;

            const li = document.createElement('li');
            li.className = 'list-item';
            li.onclick = () => openChatRoom(room.room_id, room.name, room.avatar_url, room.kind);
            
            const avatarContent = room.avatar_url 
                ? `<img src="${room.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` 
                : room.name.charAt(0).toUpperCase();

            li.innerHTML = `
                <div class="avatar-sm">${avatarContent}</div>
                <div class="item-details">
                    <div class="item-title">${escapeHtml(room.name)}</div>
                    <div class="item-sub">${getKindLabel(room.kind)}</div>
                </div>
            `;
            ul.appendChild(li);
        });

    } catch (err) {
        console.error("Fetch Chats Error:", err);
        ul.innerHTML = `<li class="empty-msg" style="color:red;">Ошибка: ${err.message}</li>`;
    }
}
function getKindLabel(kind) {
    switch(kind) {
        case 'dm': return 'Личный чат';
        case 'group': return 'Группа';
        case 'channel_pub': return 'Публичный канал';
        default: return '';
    }
}

async function openChatRoom(roomId, name, avatarUrl, kind) {
    activeRoomId = roomId;
    document.getElementById('active-chat-name').textContent = name;
    document.getElementById('active-chat-avatar').src = avatarUrl || '';
    document.getElementById('active-chat-status').textContent = getKindLabel(kind);
    
    document.getElementById('tab-chat-view').classList.remove('hidden');
    document.getElementById('tab-chats-list').classList.add('hidden');
    
    // Load History
    const { data: msgs, error } = await sb.from('xsoc_messages').select('*').eq('room_id', roomId).order('sent_at', { ascending: true });
    if(msgs) renderMessages(msgs);
    else renderMessages([]); // Clear old messages

    subscribeToRoom(roomId);
}

function closeActiveChat() {
    activeRoomId = null;
    if(currentChannelSubscription) sb.removeChannel(currentChannelSubscription);
    document.getElementById('tab-chat-view').classList.add('hidden');
    document.getElementById('tab-chats-list').classList.remove('hidden');
    fetchAndRenderChats(); 
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
    div.className = `msg-bubble ${isMine ? 'msg-mine' : 'msg-other'}`;
    
    let contentHtml = '';
    if (msg.media_type === 'image') contentHtml = `<img src="${msg.content}" style="max-width:100%; border-radius:10px;">`;
    else if (msg.media_type === 'audio') contentHtml = `<audio controls src="${msg.content}" style="width:100%;"></audio>`;
    else if (msg.media_type === 'video') contentHtml = `<video controls src="${msg.content}" style="max-width:100%; border-radius:10px;"></video>`;
    else contentHtml = escapeHtml(msg.content);

    const timeStr = new Date(msg.sent_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    div.innerHTML = `${contentHtml}<br><small style="opacity:0.7; font-size:0.7rem;">${timeStr}</small>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function subscribeToRoom(roomId) {
    if(currentChannelSubscription) sb.removeChannel(currentChannelSubscription);
    currentChannelSubscription = sb.channel(`room_${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'xsoc_messages', filter: `room_id=eq.${roomId}` }, payload => {
            if(payload.eventType === 'INSERT') appendMessageDOM(payload.new);
        })
        .subscribe();
}

async function sendMessage() {
    if(!activeRoomId || !currentUserProfile) return;
    const textarea = document.getElementById('msg-textarea');
    const text = textarea.value.trim();
    if(!text) return;

    try {
        const { error } = await sb.from('xsoc_messages').insert([{
            room_id: activeRoomId, sender_id: currentUserProfile.id, content: text, media_type: 'text'
        }]);
        if(error) throw error;
        textarea.value = '';
    } catch (err) {
        alert("Ошибка отправки");
    }
}

async function uploadMediaMessage(e) {
    const file = e.target.files[0];
    if(!file || !activeRoomId || !currentUserProfile) return;
    
    const ext = file.name.split('.').pop();
    const path = `${currentUserProfile.id}/${Date.now()}.${ext}`;
    
    try {
        const { data, error } = await sb.storage.from('xsoc-media').upload(path, file);
        if(error) throw error;

        const publicUrlResult = sb.storage.from('xsoc-media').getPublicUrl(data.path);
        const publicUrl = publicUrlResult.data.publicUrl;
        
        let type = 'image';
        if(file.type.startsWith('video')) type = 'video';
        if(file.type.startsWith('audio')) type = 'audio';

        await sb.from('xsoc_messages').insert([{
            room_id: activeRoomId, sender_id: currentUserProfile.id, content: publicUrl, media_type: type
        }]);
        e.target.value = ''; 
    } catch (err) {
        alert("Ошибка загрузки");
    }
}

// --- CONTACTS LOGIC (SIMPLE QUERIES) ---

async function fetchAndRenderContacts(searchTerm = '') {
    if(!currentUserProfile) return;
    const ul = document.getElementById('contact-list-ul');
    ul.innerHTML = '<li class="empty-msg">Загрузка...</li>';

    try {
        // 1. Get Contact IDs
        const { data: contactLinks, error: errLinks } = await sb.from('xsoc_contacts').select('target_id').eq('owner_id', currentUserProfile.id);
        if (errLinks) throw errLinks;

        if (!contactLinks || contactLinks.length === 0) {
            ul.innerHTML = '<li class="empty-msg">Нет контактов</li>';
            return;
        }

        const targetIds = contactLinks.map(c => c.target_id);

        // 2. Get Profiles
        const { data: profiles, error: errProfiles } = await sb.from('xsoc_profiles').select('*').in('id', targetIds);
        if (errProfiles) throw errProfiles;

        ul.innerHTML = '';
        profiles.forEach(prof => {
            if(!prof) return;
            if(searchTerm && !prof.full_name?.toLowerCase().includes(searchTerm.toLowerCase())) return;

            const li = document.createElement('li');
            li.className = 'list-item';
            const avatarContent = prof.avatar_url 
                ? `<img src="${prof.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` 
                : prof.username.charAt(0).toUpperCase();

            li.innerHTML = `
                <div class="avatar-sm">${avatarContent}</div>
                <div class="item-details">
                    <div class="item-title">${escapeHtml(prof.full_name || prof.username)}</div>
                    <div class="item-sub">${prof.phone_number || 'No Phone'}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="icon-btn" onclick="startCall('${prof.id}', '${escapeHtml(prof.username)}')">📞</button>
                    <button class="icon-btn" onclick="createDM('${prof.id}', '${escapeHtml(prof.username)}')">💬</button>
                </div>
            `;
            ul.appendChild(li);
        });

    } catch (err) {
        console.error("Fetch Contacts Error:", err);
        ul.innerHTML = `<li class="empty-msg" style="color:red;">Ошибка: ${err.message}</li>`;
    }
}

async function createDM(targetUserId, targetName) {
    if(!currentUserProfile) return;
    try {
        const { data: newRoom, error } = await sb.from('xsoc_rooms').insert([{
            kind: 'dm', name: targetName, creator_id: currentUserProfile.id, is_public: false
        }]).select().single();
        if(error) throw error;
        
        await sb.from('xsoc_members').insert([
            { room_id: newRoom.room_id, user_id: currentUserProfile.id, role: 'admin' },
            { room_id: newRoom.room_id, user_id: targetUserId, role: 'member' }
        ]);
        openChatRoom(newRoom.room_id, targetName, '', 'dm');
    } catch (err) { alert(err.message); }
}

function startCall(receiverId, receiverName) {
    alert(`Звонок ${receiverName}...`);
    sb.from('xsoc_calls_log').insert([{ caller_id: currentUserProfile.id, receiver_id: receiverId, status: 'missed' }]);
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
    if(!currentUserProfile) return;
    await sb.from('xsoc_profiles').update({ [field]: value }).eq('id', currentUserProfile.id);
}

async function uploadAvatar(e) {
    const file = e.target.files[0];
    if(!file || !currentUserProfile) return;
    const path = `avatars/${currentUserProfile.id}.jpg`;
    try {
        const { data, error } = await sb.storage.from('xsoc-media').upload(path, file, { upsert: true });
        if(error) throw error;
        const url = sb.storage.from('xsoc-media').getPublicUrl(path).data.publicUrl;
        await updateProfileField('avatar_url', url);
        document.getElementById('my-avatar-img').src = url;
    } catch (err) { alert(err.message); }
}

function logout() { sb.auth.signOut().then(() => location.reload()); }

function openCreateRoomModal() {
    document.getElementById('modal-root').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal-root').classList.add('hidden');
}

async function createNewRoom() {
    const kind = document.getElementById('new-room-kind').value;
    const name = document.getElementById('new-room-name').value.trim();
    if(!name) return alert("Введите название");

    try {
        const { data, error } = await sb.from('xsoc_rooms').insert([{
            kind, name, creator_id: currentUserProfile.id, is_public: kind === 'channel_pub'
        }]).select().single();
        if(error) throw error;
        closeModal();
        fetchAndRenderChats();
    } catch (err) { alert(err.message); }
}

function escapeHtml(text) {
    if(!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}

function debounce(func, wait) {
    let timeout;
    return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
}
