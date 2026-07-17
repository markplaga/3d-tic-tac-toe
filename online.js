(() => {
  const $ = id => document.getElementById(id);
  const scene = $("scene");
  const status = $("status");
  const badge = $("badge");
  const controls = document.querySelector(".controls");
  if (!scene || !controls || $("onlineMode")) return;

  let mode = "local", room = "", token = "", symbol = null, state = null, pollTimer = null, busy = false;

  const playOnline = document.createElement("button");
  playOnline.id = "onlineMode";
  playOnline.className = "btn primary";
  playOnline.textContent = "Play online";
  controls.prepend(playOnline);

  const leaveOnline = document.createElement("button");
  leaveOnline.id = "leaveOnline";
  leaveOnline.className = "btn";
  leaveOnline.textContent = "Leave online game";
  leaveOnline.hidden = true;
  controls.insertBefore(leaveOnline, $("resetView"));

  const onlineBar = document.createElement("div");
  onlineBar.id = "onlineBar";
  onlineBar.hidden = true;
  onlineBar.style.cssText = "border-radius:16px;padding:13px;background:rgba(110,231,255,.07);border:1px solid rgba(110,231,255,.18)";
  onlineBar.innerHTML = '<strong style="display:block;margin-bottom:4px">Online room</strong><div id="onlineRoomCode" style="font-size:1.35rem;letter-spacing:.16em;font-weight:950;color:var(--x)"></div><div id="onlineConnection" style="font-size:.78rem;color:var(--muted);margin-top:5px">Connecting…</div>';
  controls.parentElement.insertBefore(onlineBar, controls);

  const modal = document.createElement("div");
  modal.id = "onlineDialog";
  modal.className = "dialog";
  modal.hidden = true;
  modal.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="onlineTitle">
    <h2 id="onlineTitle">Play over the internet</h2>
    <p>Create a private room and send the invitation link, or enter a room code someone sent you.</p>
    <div class="fields">
      <div class="field"><label for="onlineName"><span>Your name</span></label><input id="onlineName" maxlength="24" placeholder="Your name"></div>
      <button id="createOnlineRoom" class="btn primary" type="button">Create an online game</button>
      <div style="display:grid;grid-template-columns:1fr auto;gap:9px"><input id="onlineRoomInput" maxlength="6" placeholder="ROOM CODE" aria-label="Room code" style="text-transform:uppercase;letter-spacing:.12em"><button id="joinOnlineRoom" class="btn" type="button">Join</button></div>
      <button id="cancelOnline" class="btn" type="button">Cancel</button>
      <div id="onlineError" style="font-size:.82rem;color:#ff9cae" aria-live="polite"></div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const localNames = () => ({
    X: ($("labelX")?.textContent || "Player 1").replace(/\s*·\s*X$/, ""),
    O: ($("labelO")?.textContent || "Player 2").replace(/\s*·\s*O$/, "")
  });

  async function api(body) {
    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Online game error.");
    return data;
  }

  function invitationUrl() {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set("room", room);
    return url.toString();
  }

  function saveSession() {
    sessionStorage.setItem("ttt3dOnline", JSON.stringify({ room, token, symbol }));
  }

  function render(next) {
    state = next;
    const names = { X: next.players.X.name, O: next.players.O.name };
    $("scoreX").textContent = next.score.X;
    $("scoreO").textContent = next.score.O;
    $("labelX").textContent = `${names.X} · X`;
    $("labelO").textContent = `${names.O} · O`;
    document.querySelectorAll(".cell").forEach(cell => {
      const i = Number(cell.dataset.index), mark = next.board[i];
      cell.textContent = mark || "";
      cell.classList.remove("x", "o", "win");
      if (mark) cell.classList.add(mark.toLowerCase());
      if ((next.winningLine || []).includes(i)) cell.classList.add("win");
      cell.disabled = Boolean(mark) || next.gameOver || !next.players.O.joined || next.currentPlayer !== symbol;
    });
    onlineBar.hidden = false;
    $("onlineRoomCode").textContent = room;
    $("onlineConnection").textContent = next.players.O.joined ? `Connected — you are ${symbol}` : "Waiting for the other player…";
    $("onlineConnection").style.color = next.players.O.joined ? "#8df5ad" : "var(--muted)";

    if (!next.players.O.joined) {
      status.textContent = `Room ${room} is ready. Share the invitation link.`;
      badge.textContent = "Waiting";
      badge.className = "badge";
    } else if (next.gameOver && next.winner === "draw") {
      status.textContent = `Draw game. ${names[next.nextStarter]} will start the next round.`;
      badge.textContent = "Draw";
      badge.className = "badge";
    } else if (next.gameOver) {
      status.textContent = `${names[next.winner]} wins! ${names[next.nextStarter]} will start the next round.`;
      badge.textContent = `${names[next.winner]} wins`;
      badge.className = `badge ${next.winner.toLowerCase()}`;
    } else {
      status.textContent = next.currentPlayer === symbol ? `Your turn, ${names[symbol]}.` : `Waiting for ${names[next.currentPlayer]}.`;
      badge.textContent = next.currentPlayer === symbol ? "Your turn" : `${names[next.currentPlayer]}'s turn`;
      badge.className = `badge ${next.currentPlayer.toLowerCase()}`;
    }
  }

  async function poll() {
    if (mode !== "online") return;
    try {
      const response = await fetch(`/api/game?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      render(data);
    } catch {
      $("onlineConnection").textContent = "Connection interrupted — retrying…";
      $("onlineConnection").style.color = "#ff9cae";
    }
  }

  function startOnline(data, playerToken, playerSymbol) {
    mode = "online";
    room = data.room;
    token = playerToken;
    symbol = playerSymbol;
    saveSession();
    modal.hidden = true;
    playOnline.hidden = true;
    leaveOnline.hidden = false;
    history.replaceState(null, "", invitationUrl());
    render(data);
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1200);
  }

  async function createRoom() {
    const name = $("onlineName").value.trim();
    if (!name) return $("onlineError").textContent = "Enter your name first.";
    try {
      $("onlineError").textContent = "";
      const result = await api({ action: "create", name });
      startOnline(result.state, result.token, result.symbol);
      await shareInvite();
    } catch (error) { $("onlineError").textContent = error.message; }
  }

  async function joinRoom() {
    const name = $("onlineName").value.trim();
    const roomCode = $("onlineRoomInput").value.trim().toUpperCase();
    if (!name || roomCode.length !== 6) return $("onlineError").textContent = "Enter your name and the six-character room code.";
    try {
      $("onlineError").textContent = "";
      const result = await api({ action: "join", room: roomCode, name });
      room = roomCode;
      startOnline(result.state, result.token, result.symbol);
    } catch (error) { $("onlineError").textContent = error.message; }
  }

  async function act(action, extra = {}) {
    if (busy) return;
    busy = true;
    try { render(await api({ action, room, token, ...extra })); }
    catch (error) { status.textContent = error.message; }
    finally { busy = false; }
  }

  async function shareInvite() {
    const url = mode === "online" ? invitationUrl() : location.href;
    const text = mode === "online" ? `Join my 3D Tic-Tac-Toe game. Room code: ${room}` : "Play 3D Tic-Tac-Toe with me!";
    try {
      if (navigator.share) return await navigator.share({ title: "3D Tic-Tac-Toe", text, url });
      await navigator.clipboard.writeText(url);
      status.textContent = mode === "online" ? "Invitation link copied. Send it to the other player." : "Game link copied.";
    } catch (error) {
      if (error?.name !== "AbortError") status.textContent = `Share this link: ${url}`;
    }
  }

  playOnline.addEventListener("click", () => {
    const names = localNames();
    $("onlineName").value = names.X === "Player 1" ? "" : names.X;
    $("onlineRoomInput").value = new URLSearchParams(location.search).get("room") || "";
    $("onlineError").textContent = "";
    modal.hidden = false;
    setTimeout(() => $("onlineName").focus(), 50);
  });
  $("createOnlineRoom").addEventListener("click", createRoom);
  $("joinOnlineRoom").addEventListener("click", joinRoom);
  $("cancelOnline").addEventListener("click", () => modal.hidden = true);
  leaveOnline.addEventListener("click", () => {
    clearInterval(pollTimer);
    sessionStorage.removeItem("ttt3dOnline");
    history.replaceState(null, "", location.pathname);
    location.reload();
  });

  scene.addEventListener("click", event => {
    if (mode !== "online") return;
    const cell = event.target.closest(".cell");
    if (!cell) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state && !state.gameOver && state.currentPlayer === symbol && !state.board[Number(cell.dataset.index)]) act("move", { index: Number(cell.dataset.index) });
  }, true);

  $("newRound").addEventListener("click", event => {
    if (mode !== "online") return;
    event.preventDefault(); event.stopImmediatePropagation(); act("newRound");
  }, true);
  $("resetScore").addEventListener("click", event => {
    if (mode !== "online") return;
    event.preventDefault(); event.stopImmediatePropagation(); act("resetMatch");
  }, true);
  $("changeNames").addEventListener("click", event => {
    if (mode !== "online") return;
    event.preventDefault(); event.stopImmediatePropagation(); status.textContent = "Online names are chosen when creating or joining a room.";
  }, true);
  $("shareGame").addEventListener("click", event => {
    if (mode !== "online") return;
    event.preventDefault(); event.stopImmediatePropagation(); shareInvite();
  }, true);

  const queryRoom = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  try {
    const saved = JSON.parse(sessionStorage.getItem("ttt3dOnline"));
    if (saved?.room && saved?.token) {
      room = saved.room; token = saved.token; symbol = saved.symbol; mode = "online";
      playOnline.hidden = true; leaveOnline.hidden = false; poll(); pollTimer = setInterval(poll, 1200);
    } else if (queryRoom) {
      $("onlineRoomInput").value = queryRoom;
      modal.hidden = false;
    }
  } catch {
    if (queryRoom) { $("onlineRoomInput").value = queryRoom; modal.hidden = false; }
  }
})();
