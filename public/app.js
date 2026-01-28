const isAdmin = document.getElementById('add-food-btn') !== null;
let currentUser = localStorage.getItem('lunch_user');

// --- SOCKET.IO ---
const socket = io();

socket.on('data_update', (data) => {
    if (data.type === 'votes' || data.type === 'menu' || data.type === 'reset') {
        loadFoodItems(); // This now updates the table AND the counts in it
    }
    if (data.type === 'users') {
        if (isAdmin) loadAdminUserList(); 
        else if (!currentUser) loadUserList();
    }
});

socket.on('status_change', (data) => {
    if (data.open === false) showMessage("Voting closed by Admin!", "orange");
});

// --- HELPERS ---
function showMessage(msg, color) {
    let elId = isAdmin ? 'admin-message' : (currentUser ? 'message' : 'login-message');
    const el = document.getElementById(elId);
    if(el) {
        el.textContent = msg;
        el.style.color = color || '#333';
        setTimeout(() => { el.textContent = ''; }, 3000);
    }
}

// --- DATA LOADING ---

// 1. Client: User Dropdown
async function loadUserList() {
    const select = document.getElementById('user-select');
    if(!select) return;

    try {
        const res = await fetch(`/api/users?t=${Date.now()}`);
        const users = await res.json();
        const currentSelection = select.value;

        select.innerHTML = '<option value="" disabled selected>Select your name...</option>';
        users.forEach(u => {
            const option = document.createElement('option');
            option.value = u.name;
            option.textContent = u.name;
            select.appendChild(option);
        });
        if(currentSelection) select.value = currentSelection;
    } catch(e) { console.error(e); }
}

// 2. Admin: User List (Pills)
async function loadAdminUserList() {
    const res = await fetch(`/api/users?t=${Date.now()}`);
    const users = await res.json();
    const container = document.getElementById('user-list-admin');
    if(!container) return;
    
    container.innerHTML = users.map(u => 
        `<div class="user-pill">
            ${u.name} 
            <button onclick="removeUser('${u.name}')">✕</button>
        </div>`
    ).join('');
}

// 3. Shared: Load Food (Handles Admin Table vs Client Cards)
async function loadFoodItems() {
    try {
        const res = await fetch(`/api/food?t=${Date.now()}`);
        const foods = await res.json();
        
        if (isAdmin) {
            // --- ADMIN VIEW: TABLE ROWS ---
            const tbody = document.getElementById('food-table-body');
            if(!tbody) return;
            tbody.innerHTML = '';
            
            if(foods.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">No food items yet. Add one above!</td></tr>';
            } else {
                foods.forEach(f => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${f.name}</td>
                        <td style="text-align:center; font-weight:bold;">${f.votes}</td>
                        <td style="text-align:right;">
                            <button onclick="removeFood(${f.id})" class="btn-remove">Remove</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } else {
            // --- CLIENT VIEW: CARDS ---
            const container = document.getElementById('food-list');
            if(!container) return;
            
            const scrollPos = window.scrollY;
            container.innerHTML = ''; 

            if(foods.length === 0) {
                container.innerHTML = '<p style="color:#888; width:100%;">No food options yet!</p>';
                return;
            }

            foods.forEach(f => {
                container.appendChild(createClientCard(f));
            });
            window.scrollTo(0, scrollPos);
        }
    } catch(err) { console.error("Error loading foods", err); }
}

// Helper for Client Cards
function createClientCard(food) {
    const card = document.createElement('div');
    card.className = 'food-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'food-name';
    nameEl.textContent = food.name;

    const countEl = document.createElement('div');
    countEl.className = 'vote-count';
    countEl.textContent = `${food.votes} Votes`;

    const btn = document.createElement('button');
    btn.textContent = 'Vote 😋';
    btn.className = 'btn-vote';
    btn.onclick = async () => {
        const voteRes = await fetch('/api/vote', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({ food_id: food.id, user_id: currentUser }) 
        });
        const data = await voteRes.json();
        showMessage(voteRes.ok ? "Vote counted!" : data.message, voteRes.ok ? 'green' : 'red');
    };

    card.appendChild(nameEl);
    card.appendChild(countEl);
    card.appendChild(btn);
    return card;
}

// --- LOGIC INITIALIZATION ---

if (isAdmin) {
    // Admin Actions
    document.getElementById('add-food-btn').onclick = async () => {
        const input = document.getElementById('food-name');
        if (!input.value.trim()) return;
        await fetch('/api/admin/add', { 
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: input.value.trim()}) 
        });
        input.value = '';
    };

    document.getElementById('add-user-btn').onclick = async () => {
        const input = document.getElementById('new-user-name');
        if (!input.value.trim()) return;
        await fetch('/api/admin/users', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: input.value.trim()})
        });
        input.value = '';
        loadAdminUserList();
    };

    // Global Admin Functions
    window.removeUser = async (name) => {
        if(!confirm(`Remove ${name}?`)) return;
        await fetch('/api/admin/users/delete', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})
        });
        loadAdminUserList();
    };

    window.removeFood = async (id) => {
        if(!confirm(`Remove this item?`)) return;
        await fetch('/api/admin/remove', { 
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id}) 
        });
    };

    // Control Panel Buttons
    document.getElementById('close-votes-btn').onclick = async () => {
        await fetch('/api/admin/close', { method: 'POST' });
        showMessage('Voting closed!', 'orange');
    };
    document.getElementById('reset-votes-btn').onclick = async () => {
        if (!confirm("Reset votes?")) return;
        await fetch('/api/admin/reset-votes', { method: 'POST' });
        showMessage('Votes reset!', 'var(--success)');
    };
    document.getElementById('reset-all-btn').onclick = async () => {
        if (!confirm("Reset EVERYTHING?")) return;
        await fetch('/api/admin/reset-all', { method: 'POST' });
        showMessage('System Reset!', 'var(--danger)');
    };

    // Init Admin
    loadFoodItems();
    loadAdminUserList();

} else {
    // Client Actions
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.onclick = () => {
            const select = document.getElementById('user-select');
            if (select.value) selectUser(select.value);
            else showMessage("Please select your name!", "var(--danger)");
        };
    }

    if (currentUser) showVotingScreen();
    else loadUserList();
}

function selectUser(name) {
    currentUser = name;
    localStorage.setItem('lunch_user', name);
    showVotingScreen();
}

function showVotingScreen() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('voting-section').style.display = 'block';
    document.getElementById('current-user-name').textContent = currentUser;
    loadFoodItems();
}

function logout() {
    localStorage.removeItem('lunch_user');
    location.reload();
}