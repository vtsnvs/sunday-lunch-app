const isAdmin = document.getElementById('add-food-btn') !== null;
let currentUser = localStorage.getItem('lunch_user');

// --- SOCKET.IO REAL-TIME SETUP ---
const socket = io();

socket.on('data_update', (data) => {
    // Refresh food list if votes change or menu updates
    if (data.type === 'votes' || data.type === 'menu' || data.type === 'reset') {
        loadFoodItems();
        // Removed loadVoteCounts() call
    }
    
    // Refresh user list logic
    if (data.type === 'users') {
        if (isAdmin) {
            loadAdminUserList(); 
        } else if (!currentUser) {
            loadUserList();
        }
    }
});

socket.on('status_change', (data) => {
    if (data.open === false) {
        showMessage("Voting has been closed by Admin!", "orange");
    }
});

// --- COMMON: UI HELPERS ---
function showMessage(msg, color) {
    let elId = 'message';
    if (isAdmin) elId = 'admin-message';
    else if (!currentUser) elId = 'login-message';

    const el = document.getElementById(elId);
    if(el) {
        el.textContent = msg;
        el.style.color = color || '#333';
        setTimeout(() => { el.textContent = ''; }, 3000);
    }
}

// --- SHARED FUNCTIONS ---

async function loadUserList() {
    const select = document.getElementById('user-select');
    if(!select) return;

    try {
        const res = await fetch(`/api/users?t=${Date.now()}`);
        const users = await res.json();
        
        const currentSelection = select.value;
        select.innerHTML = '<option value="" disabled selected>Select your name...</option>';

        if (users.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = "No names found (Ask Admin)";
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        users.forEach(u => {
            const option = document.createElement('option');
            option.value = u.name;
            option.textContent = u.name;
            select.appendChild(option);
        });

        if(currentSelection) select.value = currentSelection;

    } catch(e) {
        console.error("Failed to load users", e);
    }
}

async function loadAdminUserList() {
    const res = await fetch(`/api/users?t=${Date.now()}`);
    const users = await res.json();
    const container = document.getElementById('user-list-admin');
    if(!container) return;
    
    container.innerHTML = users.map(u => 
        `<span style="background:#eee; padding:5px 10px; border-radius:15px; display:inline-flex; align-items:center;">
            ${u.name} 
            <button onclick="removeUser('${u.name}')" style="margin-left:5px; color:red; padding:0 5px; font-size:0.8rem; background:none; border:none; cursor:pointer;">✕</button>
        </span>`
    ).join('');
}

async function loadFoodItems() {
    try {
        const res = await fetch(`/api/food?t=${Date.now()}`);
        const foods = await res.json();
        
        const containerId = isAdmin ? 'food-items' : 'food-list';
        const container = document.getElementById(containerId);
        if(!container) return;
        
        const scrollPos = window.scrollY;
        container.innerHTML = ''; 

        if(foods.length === 0) {
            container.innerHTML = '<p style="color:#888; width:100%;">No food options yet!</p>';
            return;
        }

        foods.forEach(f => {
            container.appendChild(createFoodCard(f, isAdmin));
        });

        window.scrollTo(0, scrollPos);

    } catch(err) {
        console.error("Error loading foods", err);
    }
}

function createFoodCard(food, isForAdmin) {
    const card = document.createElement('div');
    card.className = 'food-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'food-name';
    nameEl.textContent = food.name;

    const countEl = document.createElement('div');
    countEl.className = 'vote-count';
    countEl.textContent = `${food.votes} Votes`;

    const btn = document.createElement('button');
    
    if (isForAdmin) {
        btn.textContent = 'Remove';
        btn.className = 'btn-remove';
        btn.onclick = async () => {
            if(!confirm(`Remove ${food.name}?`)) return;
            await fetch('/api/admin/remove', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({id: food.id}) 
            });
        };
    } else {
        btn.textContent = 'Vote 😋';
        btn.className = 'btn-vote';

        btn.onclick = async () => {
            const voteRes = await fetch('/api/vote', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({
                    food_id: food.id,
                    user_id: currentUser 
                }) 
            });
            
            const data = await voteRes.json();

            if(voteRes.ok) {
                showMessage("Vote counted!", 'green');
            } else {
                showMessage(data.message, 'red');
            }
        };
    }

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
        const name = input.value.trim();
        if (!name) return;
        
        await fetch('/api/admin/add', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({name}) 
        });
        
        input.value = '';
    };

    document.getElementById('add-user-btn').onclick = async () => {
        const input = document.getElementById('new-user-name');
        const name = input.value.trim();
        if (!name) return;

        await fetch('/api/admin/users', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({name})
        });
        input.value = '';
        loadAdminUserList();
    };
    
    window.removeUser = async (name) => {
        if(!confirm(`Remove ${name} from team?`)) return;
        await fetch('/api/admin/users/delete', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify({name})
        });
        loadAdminUserList();
    };

    // Control Panel Buttons
    document.getElementById('close-votes-btn').onclick = async () => {
        await fetch('/api/admin/close', { method: 'POST' });
        showMessage('Voting closed!', 'orange');
    };

    document.getElementById('reset-votes-btn').onclick = async () => {
        if (!confirm("Reset votes for new week?")) return;
        await fetch('/api/admin/reset-votes', { method: 'POST' });
        showMessage('New week started!', 'var(--success)');
    };

    document.getElementById('reset-all-btn').onclick = async () => {
        if (!confirm("Reset EVERYTHING?")) return;
        await fetch('/api/admin/reset-all', { method: 'POST' });
        showMessage('System Reset!', 'var(--danger)');
    };

    // Initial Loads (Removed loadVoteCounts call)
    loadFoodItems();
    loadAdminUserList();

} else {
    // Client Actions
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.onclick = () => {
            const select = document.getElementById('user-select');
            const name = select.value;
            if (name) {
                selectUser(name);
            } else {
                showMessage("Please select your name first!", "var(--danger)");
            }
        };
    }

    if (currentUser) {
        showVotingScreen();
    } else {
        loadUserList();
    }
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