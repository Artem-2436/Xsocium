// --- ДИАГНОСТИКА ЗАГРУЗКИ БИБЛИОТЕКИ ---
console.log("--- START DIAGNOSTICS ---");
console.log("Window object:", window);
console.log("Is 'supabase' global variable present?", typeof window.supabase);

if (typeof window.supabase === 'undefined') {
    console.error("CRITICAL ERROR: Library Supabase did NOT load!");
    alert("Библиотека Supabase не загрузилась! Проверьте интернет или блокировщик рекламы.");
} else {
    console.log("Success: Library loaded. Available methods:", Object.keys(window.supabase));
}
console.log("--- END DIAGNOSTICS ---\n");
// ==========================================
// Xsocium App Logic (Fixed Version)
// ==========================================

// --- CONFIGURATION ---
// ЗАМЕНИ ЭТИ ЗНАЧЕНИЯ НА СВОИ ИЗ SUPABASE DASHBOARD!
const SUPABASE_URL = 'https://epklfzbvlqzarptpwsdn.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_aa5ojwVrZ7pfLE0ec0DV5w_p3Zk2fcn'; 

// Инициализация клиента с уникальным именем 'sb', чтобы не конфликтовать с глобальной переменной библиотеки
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Глобальные переменные состояния
let currentUserProfile = null;
let activeRoomId = null;
let currentChannelSubscription = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Xsocium initializing...");
    setupEventListeners();
    await checkSession();
});

function setupEventListeners() {
    // 1. Auth Tabs Switching
    const btnLogin = document.querySelector('.tab-btn:nth-child(1)');
    const btnReg = document.querySelector('.tab-btn:nth-child(2)');
    
    if(btnLogin && btnReg) {
        btnLogin.addEventListener('click', () => switchAuthTab('login'));
        btnReg.addEventListener('click', () => switchAuthTab('register'));
    }

    // 2. Form Submissions
    const formLogin = document.getElementById('form-login');
    const formRegister = document.getElementById('form-register');

    if(formLogin) formLogin.addEventListener('submit', handleLogin);
    if(formRegister) formRegister.addEventListener('submit', handleRegister);

    // 3. Bottom Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = e.currentTarget.dataset.tab;
            if(tabId) switchMainTab(tabId);
        });
    });

    // 4. Search Inputs
    const globalSearch = document.getElementById('global-search');
    const contactSearch = document.getElementById('contact-search');
    
    if(globalSearch) globalSearch.addEventListener('input', debounce(() => fetchAndRenderChats(globalSearch.value), 300));
    if(contactSearch) contactSearch.addEventListener('input', debounce(() => fetchAndRenderContacts(contactSearch.value), 300));

    // 5. File Uploads
    const avatarUpload = document.getElementById('avatar-upload');
    const fileUpload = document.getElementById('file-upload');
    
    if(avatarUpload) avatarUpload.addEventListener('change', uploadAvatar);
    if(fileUpload) fileUpload.addEventListener('change', uploadMediaMessage);

    // 6. Settings Controls
    const darkToggle = document.getElementById('dark-mode-toggle');
    const themeSelect = document.getElementById('theme-color-select');
    
    if(darkToggle) darkToggle.addEventListener('change', toggleDarkMode);
    if(themeSelect) themeSelect.addEventListener('change', changeThemeColor);
}

// --- AUTH LOGIC ---

async function checkSession() {
    try {
        const { data: { session }, error } = await sb.auth.getSession();
        
        if (error) throw error;

        if (session) {
            console.log("User logged in:", session.user.email);
            await loadUserProfile(session.user.id);
        } else {
            showView('view-auth');
        }

        // Listen for future auth state changes
        sb.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                location.reload();
            }
        });

    } catch (err) {
        console.error("Session check failed:", err);
        showView('view-auth');
    }
}

function showView(viewId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(viewId);
    if(target) target.classList.remove('hidden');
}

function switchAuthTab(tabName) {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const tabs = document.querySelectorAll('.tab-btn');
    
    // Reset visibility
    if(loginForm) loginForm.classList.add('hidden');
    if(registerForm) registerForm.classList.add('hidden');
    
    // Reset active states
    tabs.forEach(t => t.classList.remove('active'));

    if (tabName === 'login') {
        if(loginForm) loginForm.classList.remove('hidden');
        if(tabs[0]) tabs[0].classList.add('active');
    } else {
        if(registerForm) registerForm.classList.remove('hidden');
        if(tabs[1]) tabs[1].classList.add('active');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const emailInput = e.target.querySelector('input[type="email"]');
    const passInput = e.target.querySelector('input[type="password"]');
    
    if(!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const password = passInput.value;

    if(!email || !password) {
        alert("Заполните все поля");
        return;
    }

    try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // Success handled by onAuthStateChange or manual reload logic below
        // But let's force profile load immediately for better UX
        const { data: { session } } = await sb.auth.getSession();
        if(session) await loadUserProfile(session.user.id);
        
    } catch (err) {
        console.error("Login Error:", err);
        alert("Ошибка входа: " + err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const inputs = e.target.querySelectorAll('input');
    // Order: Username, Email, Password
    const username = inputs[0]?.value.trim();
    const email = inputs[1]?.value.trim();
    const password = inputs[2]?.value;

    if(!username || !email || !password) {
        alert("Заполните все поля");
        return;
    }

    try {
        // 1. Sign up in Auth
        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: {
                data: { username: username }
            }
        });
        
        if (error) throw error;

        // 2. Create Profile in Database
        if(data.user) {
            await createInitialProfile(data.user.id, username);
            
            // Auto Login after registration
            const { error: signInError } = await sb.auth.signInWithPassword({ email, password });
            if (!signInError) {
                 const { data: { session } } = await sb.auth.getSession();
                 if(session) await loadUserProfile(session.user.id);
            }
        }

    } catch (err) {
        console.error("Registration Error:", err);
        alert("Ошибка регистрации: " + err.message);
    }
}

async function createInitialProfile(userId, username) {
    try {
        const { error } = await sb.from('xsoc_profiles').insert([{
            id: userId,
            username: username,
            full_name: username,
            phone_number: null,
            theme_color: '#007bff',
            is_dark_mode: false
        }]);
        if (error) throw error;
    } catch (err) {
        console.error("Profile Creation Failed:", err);
        // If it fails because user exists, ignore. Otherwise log.
    }
}

async function loadUserProfile(userId) {
    const loader = document.getElementById('loader-profile');
    if(loader) loader.classList.remove('hidden');
    
    try {
        const { data, error } = await sb
            .from('xsoc_profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            // Fallback if profile missing but session valid
            await createInitialProfile(userId, 'User'+Math.floor(Math.random()*1000));
            return loadUserProfile(userId);
        }

        currentUserProfile = data;
        applyThemeSettings(data);
        renderAppUI(data);
        
        // Load initial data
        await Promise.all([
            fetchAndRenderChats(),
            fetchAndRenderContacts()
        ]);
        
        showView('view-app');
    } catch (err) {
        console.error("Load Profile Error:", err);
        alert("Не удалось загрузить профиль. Проверьте консоль.");
    } finally {
        if(loader) loader.classList.add('hidden');
    }
}

function applyThemeSettings(profile) {
    if (profile.is_dark_mode) document.body.classList.add('dark-theme');
    else document.body.classList.remove('dark-theme');
    
    document.documentElement.style.setProperty('--primary', profile.theme_color);
    
    const darkToggle = document.getElementById('dark-mode-toggle');
    const themeSelect = document.getElementById('theme-color-select');
    
    if(darkToggle) darkToggle.checked = profile.is_dark_mode;
    if(themeSelect) themeSelect.value = profile.theme_color;
}

function renderAppUI(profile) {
    const nameEl = document.getElementById('my-fullname');
    const phoneEl = document.getElementById('my-phone');
    const avatarEl = document.getElementById('my-avatar-img');
    
    if(nameEl) nameEl.textContent = profile.full_name || profile.username;
    if(phoneEl) phoneEl.textContent = profile.phone_number || 'Не указан';
    
    if(avatarEl) {
        if(profile.avatar_url) {
            avatarEl.src = profile.avatar_url;
            avatarEl.alt = "";
        } else {
            // Show first letter fallback
            avatarEl.src = ''; 
            avatarEl.alt = profile.username.charAt(0).toUpperCase();
            avatarEl.style.display = 'none'; // Hide img, show text via CSS pseudo-element or sibling if implemented
            // For simplicity in this fix, we just leave src empty. 
            // Ideally, you'd have a div behind the image showing the letter.
        }
    }
}

// --- NAVIGATION & TABS ---

function switchMainTab(tabId) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
    const targetPane = document.getElementById(tabId);
    if(targetPane) targetPane.classList.remove('hidden');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const activeBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if(activeBtn) activeBtn.classList.add('active');
    
    // Refresh data when switching to relevant tabs
    if(tabId === 'tab-chats-list') fetchAndRenderChats();
    if(tabId === 'tab-contacts') fetchAndRenderContacts();
}

// --- CHAT LOGIC ---

async function fetchAndRenderChats(searchTerm = '') {
    if(!currentUserProfile) return;

    try {
        // Fetch rooms where user is member OR public channels
        const { data: rooms, error } = await sb
            .from('xsoc_rooms')
            .select('*, xsoc_members(user_id, role)')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const ul = document.getElementById('chat-list-ul');
        if(!ul) return;
        ul.innerHTML = '';

        rooms.forEach(room => {
            const isMember = room.xsoc_members.some(m => m.user_id === currentUserProfile.id);
            const isPublicChannel = room.kind === 'channel_pub' && room.is_public;
            
            // Security Filter: Only show if member or public channel
            if (!isMember && !isPublicChannel) return;

            // Search Filter
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
    }
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
    
    const nameEl = document.getElementById('active-chat-name');
    const avatarEl = document.getElementById('active-chat-avatar');
    const statusEl = document.getElementById('active-chat-status');
    
    if(nameEl) nameEl.textContent = name;
    if(avatarEl) avatarEl.src = avatarUrl || '';
    if(statusEl) statusEl.textContent = getKindLabel(kind);
    
    // Switch views
    document.getElementById('tab-chat-view').classList.remove('hidden');
    document.getElementById('tab-chats-list').classList.add('hidden');
    
    // Load History
    try {
        const { data: msgs, error } = await sb
            .from('xsoc_messages')
            .select('*')
            .eq('room_id', roomId)
            .order('sent_at', { ascending: true });
            
        if(msgs) renderMessages(msgs);
    } catch(err) {
        console.error("Load Messages Error:", err);
    }

    // Subscribe to Realtime
    subscribeToRoom(roomId);
}

function closeActiveChat() {
    activeRoomId = null;
    if(currentChannelSubscription) {
        sb.removeChannel(currentChannelSubscription);
        currentChannelSubscription = null;
    }
    document.getElementById('tab-chat-view').classList.add('hidden');
    document.getElementById('tab-chats-list').classList.remove('hidden');
    fetchAndRenderChats(); // Refresh list
}

function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    if(!container) return;
    container.innerHTML = '';
    messages.forEach(msg => appendMessageDOM(msg));
    container.scrollTop = container.scrollHeight;
}

function appendMessageDOM(msg) {
    const container = document.getElementById('messages-container');
    if(!container) return;
    
    const div = document.createElement('div');
    const isMine = msg.sender_id === currentUserProfile.id;
    div.className = `msg-bubble ${isMine ? 'msg-mine' : ''}`;
    
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
    
    // Strict filter ensures we only get messages for THIS room
    currentChannelSubscription = sb.channel(`room_${roomId}`)
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
            if(status === 'SUBSCRIBED') console.log('Realtime connected:', roomId);
        });
}

async function sendMessage() {
    if(!activeRoomId || !currentUserProfile) return;
    
    const textarea = document.getElementById('msg-textarea');
    if(!textarea) return;
    
    const text = textarea.value.trim();
    if(!text) return;

    try {
        const { error } = await sb.from('xsoc_messages').insert([{
            room_id: activeRoomId,
            sender_id: currentUserProfile.id,
            content: text,
            media_type: 'text'
        }]);

        if(error) throw error;
        textarea.value = '';
    } catch (err) {
        console.error("Send Message Error:", err);
        alert("Ошибка отправки сообщения");
    }
}

async function uploadMediaMessage(e) {
    const file = e.target.files[0];
    if(!file || !activeRoomId || !currentUserProfile) return;
    
    const ext = file.name.split('.').pop();
    const path = `${currentUserProfile.id}/${Date.now()}.${ext}`;
    
    try {
        // Upload to Storage Bucket 'xsoc-media'
        const { data, error } = await sb.storage.from('xsoc-media').upload(path, file);
        if(error) throw error;

        const publicUrlResult = sb.storage.from('xsoc-media').getPublicUrl(data.path);
        const publicUrl = publicUrlResult.data.publicUrl;
        
        let type = 'image';
        if(file.type.startsWith('video')) type = 'video';
        if(file.type.startsWith('audio')) type = 'audio';

        await sb.from('xsoc_messages').insert([{
            room_id: activeRoomId,
            sender_id: currentUserProfile.id,
            content: publicUrl,
            media_type: type
        }]);
        
        e.target.value = ''; // Reset input
    } catch (err) {
        console.error("Upload Media Error:", err);
        alert("Ошибка загрузки файла");
    }
}

function triggerFileInput() {
    const input = document.getElementById('file-upload');
    if(input) input.click();
}

// --- CONTACTS LOGIC ---

async function fetchAndRenderContacts(searchTerm = '') {
    if(!currentUserProfile) return;

    try {
        const { data: contacts, error } = await sb
            .from('xsoc_contacts')
            .select('target_id, xsoc_profiles(*)')
            .eq('owner_id', currentUserProfile.id);

        if (error) throw error;

        const ul = document.getElementById('contact-list-ul');
        if(!ul) return;
        ul.innerHTML = '';

        contacts.forEach(c => {
            const prof = c.xsoc_profiles;
            if(!prof) return;

            const searchLower = searchTerm.toLowerCase();
            const nameMatch = prof.full_name?.toLowerCase().includes(searchLower);
            const userMatch = prof.username?.toLowerCase().includes(searchLower);
            
            if(searchTerm && !nameMatch && !userMatch) return;

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
    }
}

async function createDM(targetUserId, targetName) {
    if(!currentUserProfile) return;

    try {
        // Check if DM already exists between these two users? 
        // Simplified: Just create a new one for now. In prod, query existing pairs.
        
        const { data: newRoom, error } = await sb.from('xsoc_rooms').insert([{
            kind: 'dm',
            name: targetName,
            creator_id: currentUserProfile.id,
            is_public: false
        }]).select().single();

        if(error) throw error;
        
        // Add both users as members
        await sb.from('xsoc_members').insert([
            { room_id: newRoom.room_id, user_id: currentUserProfile.id, role: 'admin' },
            { room_id: newRoom.room_id, user_id: targetUserId, role: 'member' }
        ]);
        
        openChatRoom(newRoom.room_id, targetName, '', 'dm');
        
    } catch (err) {
        console.error("Create DM Error:", err);
        alert("Ошибка создания чата");
    }
}

function startCall(receiverId, receiverName) {
    // Simulation of call logging
    alert(`Звонок ${receiverName}...\n(WebRTC signaling would go here)`);
    sb.from('xsoc_calls_log').insert([{
        caller_id: currentUserProfile.id,
        receiver_id: receiverId,
        status: 'missed'
    }]).catch(console.error);
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
    try {
        await sb.from('xsoc_profiles').update({ [field]: value }).eq('id', currentUserProfile.id);
    } catch (err) {
        console.error("Update Profile Field Error:", err);
    }
}

async function uploadAvatar(e) {
    const file = e.target.files[0];
    if(!file || !currentUserProfile) return;
    
    const path = `avatars/${currentUserProfile.id}.jpg`;
    
    try {
        const { data, error } = await sb.storage.from('xsoc-media').upload(path, file, { cacheControl: '3600', upsert: true });
        if(error) throw error;

        const urlResult = sb.storage.from('xsoc-media').getPublicUrl(path);
        const url = urlResult.data.publicUrl;
        
        await updateProfileField('avatar_url', url);
        currentUserProfile.avatar_url = url;
        
        const imgEl = document.getElementById('my-avatar-img');
        if(imgEl) imgEl.src = url;
        
    } catch (err) {
        console.error("Avatar Upload Error:", err);
        alert("Ошибка загрузки аватарки");
    }
}

function logout() {
    sb.auth.signOut().then(() => {
        location.reload();
    });
}

function deleteAccountConfirm() {
    if(confirm("Вы уверены? Все данные будут удалены навсегда.")) {
        // Note: Deleting auth user usually requires Edge Function for security reasons.
        // Here we attempt direct deletion which might fail depending on Supabase settings.
        sb.from('xsoc_profiles').delete().eq('id', currentUserProfile.id).then(({error}) => {
            if(error) alert("Ошибка удаления профиля: " + error.message);
            else sb.auth.signOut().then(() => location.reload());
        });
    }
}

function changePasswordPrompt() {
    const newPass = prompt("Новый пароль:");
    if(newPass) {
        sb.auth.updateUser({ password: newPass }).then(({error}) => {
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
    if(!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
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
    if(!modalRoot) return;
    
    modalRoot.innerHTML = `
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">×</span>
            <h3>Новая комната</h3>
            <select id="new-room-kind" style="width:100%; padding:10px; margin:10px 0;">
                <option value="group">Группа</option>
                <option value="channel_pub">Публичный Канал</option>
                <option value="channel_priv">Закрытый Канал</option>
            </select>
            <input type="text" id="new-room-name" placeholder="Название" style="width:100%; padding:10px; margin-bottom:10px;">
            <button onclick="createNewRoom()" style="width:100%; padding:10px; background:var(--primary); color:white; border:none; border-radius:5px; cursor:pointer;">Создать</button>
        </div>
    `;
    modalRoot.classList.remove('hidden');
}

function closeModal() {
    const modalRoot = document.getElementById('modal-root');
    if(modalRoot) modalRoot.classList.add('hidden');
}

async function createNewRoom() {
    const kindSelect = document.getElementById('new-room-kind');
    const nameInput = document.getElementById('new-room-name');
    
    if(!kindSelect || !nameInput) return;

    const kind = kindSelect.value;
    const name = nameInput.value.trim();
    
    if(!name) return alert("Введите название");

    try {
        const { data, error } = await sb.from('xsoc_rooms').insert([{
            kind: kind,
            name: name,
            creator_id: currentUserProfile.id,
            is_public: kind === 'channel_pub'
        }]).select().single();

        if(error) throw error;
        
        closeModal();
        fetchAndRenderChats();
    } catch (err) {
        console.error("Create Room Error:", err);
        alert("Ошибка создания комнаты");
    }
}
