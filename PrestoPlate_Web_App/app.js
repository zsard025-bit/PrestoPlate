/* PRESTOPLATE - CAFETERIA PRE-ORDERING SYSTEM */

const SUPABASE_URL = "https://krqjyqiilhxuhhwcbgnh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Wl8GJjsyscoV8c26plPwwg_xUKFYRsy";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const $ = id => document.getElementById(id);

const state = {
  user: null,
  profile: null,
  menu: [],
  cart: new Map()
};

/* HELPER FUNCTIONS */

function money(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number(value || 0));
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function message(id, text, error = false) {
  const element = $(id);
  if (!element) return;

  element.textContent = text || "";
  element.classList.toggle("error", error);
}

function dateText(value) {
  if (!value) return "Not set";

  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function statusClass(value) {
  return String(value || "").toLowerCase().replaceAll(" ", "-");
}

function report(error) {
  console.error(error);
  return error?.message || "An unexpected error occurred.";
}

/* AUTHENTICATION */

async function getProfile() {
  state.profile = null;

  if (!state.user) return;

  const { data, error } = await db
    .from("profiles")
    .select("user_id,display_name,role")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (error) throw error;

  state.profile = data;
}

async function signIn(event) {
  event.preventDefault();
  message("auth-message", "");

  const email = $("email").value.trim();
  const password = $("password").value;

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    message("auth-message", report(error), true);
    return;
  }

  state.user = data.user;

  try {
    await getProfile();

    if (!state.profile) {
      await db.auth.signOut();
      state.user = null;

      await updateInterface();

      message(
        "auth-message",
        "Your profile was not found. Contact the administrator.",
        true
      );
      return;
    }

    if (!["customer", "staff"].includes(state.profile.role)) {
      await db.auth.signOut();
      state.user = null;
      state.profile = null;

      await updateInterface();

      message(
        "auth-message",
        "This account does not have an authorized role. Contact the administrator.",
        true
      );
      return;
    }

    await updateInterface();
    await loadMenu();

    message(
      "auth-message",
      state.profile.role === "staff"
        ? "Signed in successfully as cafeteria staff."
        : "Signed in successfully as customer / student."
    );
  } catch (error) {
    message("auth-message", report(error), true);
  }
}

async function signUp() {
  message("auth-message", "");

  const name = $("display-name").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!name) {
    message("auth-message", "Enter your full name to register.", true);
    return;
  }

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: name }
    }
  });

  if (error) {
    message("auth-message", report(error), true);
    return;
  }

  if (!data.session) {
    message(
      "auth-message",
      "Account created. Confirm your email if required, then sign in."
    );
    return;
  }

  state.user = data.user;

  try {
    await getProfile();

    if (!state.profile || state.profile.role !== "customer") {
      await db.auth.signOut();
      state.user = null;
      state.profile = null;

      await updateInterface();

      message(
        "auth-message",
        "The account profile is missing or has an unexpected role. Contact the administrator.",
        true
      );
      return;
    }

    await updateInterface();
    await loadMenu();

    message("auth-message", "Customer account created successfully.");
  } catch (error) {
    message("auth-message", report(error), true);
  }
}

async function signOut() {
  const { error } = await db.auth.signOut();

  if (error) {
    message("auth-message", report(error), true);
    return;
  }

  state.user = null;
  state.profile = null;
  state.cart.clear();

  renderCart();
  await updateInterface();
  await loadMenu();
}

async function updateInterface() {
  const signedIn = Boolean(state.user);
  const role = state.profile?.role;

  $("auth-panel").classList.toggle("hidden", signedIn);
  $("signout-btn").classList.toggle("hidden", !signedIn);

  $("session-label").textContent = signedIn
    ? `${state.profile?.display_name || state.user.email} · ${role || "Unassigned"}`
    : "Not signed in";

  $("customer-panel").classList.toggle(
    "hidden",
    role !== "customer"
  );

  $("staff-panel").classList.toggle(
    "hidden",
    role !== "staff"
  );

  if (role === "customer") {
    await loadCustomerOrders();
  } else {
    $("orders-list").innerHTML =
      '<p class="muted">Customer order history is available to customers only.</p>';
  }

  if (role === "staff") {
    await loadStaffOrders();
    await renderStaffMenu();
  } else {
    $("staff-orders-list").innerHTML =
      '<p class="muted">Staff order monitoring is available to staff only.</p>';
    $("staff-menu-list").innerHTML = "";
  }
}

/* CUSTOMER MENU */

async function loadMenu() {
  const { data, error } = await db
    .from("menu_items")
    .select("menu_item_id,name,description,price,stock_quantity,is_available,image_url")
    .order("name");

  if (error) {
    message("menu-message", `Could not load menu: ${report(error)}`, true);
    return;
  }

  state.menu = data || [];

  for (const [id, quantity] of state.cart.entries()) {
    const item = state.menu.find(
      meal => Number(meal.menu_item_id) === id
    );

    if (
      !item ||
      !item.is_available ||
      Number(item.stock_quantity) < quantity
    ) {
      state.cart.delete(id);
    }
  }

  renderMenu();
  renderCart();

  message(
    "menu-message",
    state.menu.some(item =>
      item.is_available && Number(item.stock_quantity) > 0
    )
      ? "Select a meal and add it to your cart."
      : "No meals are currently available."
  );

  if (state.profile?.role === "staff") {
    await renderStaffMenu();
  }
}

function renderMenu() {
  const root = $("menu-grid");
  if (!root) return;

  const available = state.menu.filter(item =>
    item.is_available && Number(item.stock_quantity) > 0
  );

  if (!available.length) {
    root.innerHTML =
      '<div class="empty-state">No available meals right now.</div>';
    return;
  }

  root.innerHTML = available.map(item => {
    const id = Number(item.menu_item_id);
    const stock = Number(item.stock_quantity);

    const photo = item.image_url
      ? `<img class="meal-photo" src="${safe(item.image_url)}" alt="${safe(item.name)}" loading="lazy">`
      : '<div class="meal-placeholder">🍽️</div>';

    return `
      <article class="meal-card">
        ${photo}
        <div class="meal-content">
          <div class="meal-price">${money(item.price)}</div>
          <h3>${safe(item.name)}</h3>
          <p class="description">
            ${safe(item.description || "Freshly prepared at the cafeteria.")}
          </p>
          <div class="stock-line ${stock <= 5 ? "stock-low" : "stock-ok"}">
            ${stock} available
          </div>
          <div class="add-controls">
            <input class="qty-input" type="number" min="1"
              max="${stock}" value="1" step="1"
              id="qty-${id}" aria-label="Quantity for ${safe(item.name)}">
            <button class="button secondary" type="button"
              data-add="${id}">Add</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  root.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      if (state.profile?.role !== "customer") return;

      const id = Number(button.dataset.add);
      const item = state.menu.find(
        meal => Number(meal.menu_item_id) === id
      );

      const quantity = Number($(`qty-${id}`).value);

      if (
        !item ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > Number(item.stock_quantity)
      ) {
        message(
          "order-message",
          "Enter a valid quantity within available stock.",
          true
        );
        return;
      }

      const previousQuantity = state.cart.get(id) || 0;
      const combinedQuantity = previousQuantity + quantity;

      if (combinedQuantity > Number(item.stock_quantity)) {
        message(
          "order-message",
          "The total quantity in your cart exceeds the available stock.",
          true
        );
        return;
      }

      state.cart.set(id, combinedQuantity);
      renderCart();
      message("order-message", "Meal added to your cart.");
    });
  });
}

/* CUSTOMER CART */

function renderCart() {
  const root = $("cart-items");
  if (!root) return;

  const items = [...state.cart.entries()].map(([id, quantity]) => ({
    item: state.menu.find(meal => Number(meal.menu_item_id) === id),
    quantity
  })).filter(row => row.item);

  $("cart-count").textContent = items.reduce(
    (sum, row) => sum + row.quantity,
    0
  );

  $("cart-total").textContent = money(items.reduce(
    (sum, row) => sum + Number(row.item.price) * row.quantity,
    0
  ));

  if (!items.length) {
    root.innerHTML = '<p class="muted">Your cart is empty.</p>';
    return;
  }

  root.innerHTML = items.map(({ item, quantity }) => `
    <div class="cart-line">
      <div>
        <strong>${safe(item.name)}</strong>
        <small>${quantity} × ${money(item.price)}</small>
      </div>
      <div>
        <strong>${money(Number(item.price) * quantity)}</strong><br>
        <button class="remove-button" type="button"
          data-remove="${item.menu_item_id}">Remove</button>
      </div>
    </div>
  `).join("");

  root.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      state.cart.delete(Number(button.dataset.remove));
      renderCart();
    });
  });
}

function setPickupDefault() {
  const future = new Date(Date.now() + 60 * 60 * 1000);

  const local = new Date(
    future.getTime() - future.getTimezoneOffset() * 60000
  );

  $("pickup-date").value = local.toISOString().slice(0, 10);
  $("pickup-time").value = local.toISOString().slice(11, 16);
}

async function placeOrder() {
  message("order-message", "");

  if (state.profile?.role !== "customer") {
    message("order-message", "Only customers can place orders.", true);
    return;
  }

  if (!state.cart.size) {
    message("order-message", "Your cart is empty.", true);
    return;
  }

  const date = $("pickup-date").value;
  const time = $("pickup-time").value;
  const pickup = new Date(`${date}T${time}`);

  if (
    !date ||
    !time ||
    Number.isNaN(pickup.getTime()) ||
    pickup <= new Date()
  ) {
    message(
      "order-message",
      "Choose a valid pickup date and future time.",
      true
    );
    return;
  }

  const items = [...state.cart.entries()].map(
    ([menu_item_id, quantity]) => ({ menu_item_id, quantity })
  );

  $("place-order-btn").disabled = true;

  try {
    const { data, error } = await db.rpc("place_food_order", {
      p_items: items,
      p_pickup_at: pickup.toISOString()
    });

    if (error) throw error;

    state.cart.clear();
    renderCart();

    message("order-message", `Order #${data} placed successfully.`);

    await loadMenu();
    await loadCustomerOrders();
  } catch (error) {
    message("order-message", report(error), true);
  } finally {
    $("place-order-btn").disabled = false;
  }
}

/* CUSTOMER ORDER HISTORY */

async function loadCustomerOrders() {
  if (state.profile?.role !== "customer") return;

  const root = $("orders-list");

  const { data: orders, error } = await db
    .from("orders")
    .select("order_id,customer_id,pickup_at,status,created_at")
    .eq("customer_id", state.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    root.innerHTML =
      `<p class="message error">${safe(report(error))}</p>`;
    return;
  }

  if (!orders?.length) {
    root.innerHTML =
      '<div class="empty-state">You have not placed any orders yet.</div>';
    return;
  }

  const html = [];

  for (const order of orders) {
    const { data: lines, error: lineError } = await db
      .from("order_items")
      .select("quantity,unit_price,menu_items(name)")
      .eq("order_id", order.order_id);

    if (lineError) {
      html.push(
        `<article class="order-card">${safe(lineError.message)}</article>`
      );
      continue;
    }

    const itemsHtml = (lines || []).map(line =>
      `${safe(line.menu_items?.name || "Meal")} × ${line.quantity} — ${money(Number(line.unit_price) * Number(line.quantity))}`
    ).join("<br>");

    html.push(`
      <article class="order-card">
        <div class="order-card-header">
          <div>
            <h3>Order #${order.order_id}</h3>
            <div class="order-meta">
              Placed: ${safe(dateText(order.created_at))}<br>
              Pickup: ${safe(dateText(order.pickup_at))}
            </div>
          </div>
          <span class="status-pill status-${statusClass(order.status)}">
            ${safe(order.status)}
          </span>
        </div>
        <div class="order-items">${itemsHtml}</div>
        ${order.status === "Pending"
          ? `<button class="button secondary" type="button"
               data-cancel="${order.order_id}">Cancel order</button>`
          : ""}
      </article>
    `);
  }

  root.innerHTML = html.join("");

  root.querySelectorAll("[data-cancel]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.cancel);

      if (!confirm(`Cancel order #${id}?`)) return;

      const { data, error } = await db.rpc("cancel_my_order", {
        p_order_id: id
      });

      if (error) {
        message("order-message", report(error), true);
        return;
      }

      if (!data) {
        message(
          "order-message",
          "This order can no longer be cancelled.",
          true
        );
        return;
      }

      message("order-message", `Order #${id} cancelled.`);

      await loadCustomerOrders();
      await loadMenu();
    });
  });
}

/* STAFF MENU MANAGEMENT */

async function renderStaffMenu() {
  if (state.profile?.role !== "staff") return;

  const root = $("staff-menu-list");

  const { data, error } = await db
    .from("menu_items")
    .select("menu_item_id,name,description,price,stock_quantity,is_available,image_url")
    .order("name");

  if (error) {
    root.innerHTML =
      `<p class="message error">${safe(report(error))}</p>`;
    return;
  }

  if (!data?.length) {
    root.innerHTML =
      '<div class="empty-state">No menu items yet.</div>';
    return;
  }

  root.innerHTML = data.map(item => `
    <article class="staff-menu-item">
      <div>
        ${item.image_url
          ? `<img class="staff-menu-photo"
              src="${safe(item.image_url)}" alt="${safe(item.name)}">`
          : '<div class="staff-menu-photo meal-placeholder">🍽️</div>'}
      </div>

      <div class="staff-menu-details">
        <strong>${safe(item.name)}</strong>
        <div class="order-meta">
          ${money(item.price)} · Stock: ${item.stock_quantity}
        </div>
        <div class="order-meta">
          ${item.is_available ? "Available" : "Hidden from customers"}
        </div>

        <form class="edit-menu-form" data-edit-form="${item.menu_item_id}">
          <label>
            Food or drink name
            <input id="edit-name-${item.menu_item_id}"
              type="text" maxlength="120"
              value="${safe(item.name)}" required>
          </label>

          <label>
            Description
            <input id="edit-description-${item.menu_item_id}"
              type="text" maxlength="500"
              value="${safe(item.description || "")}">
          </label>

          <label>
            Replace photo (optional)
            <input id="edit-photo-${item.menu_item_id}"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif">
          </label>

          <div class="two-fields">
            <label>
              Price (₱)
              <input id="edit-price-${item.menu_item_id}"
                type="number" min="0" step="0.01"
                value="${Number(item.price)}" required>
            </label>

            <label>
              Stock quantity
              <input id="edit-stock-${item.menu_item_id}"
                type="number" min="0" step="1"
                value="${Number(item.stock_quantity)}" required>
            </label>
          </div>

          <div class="staff-order-controls">
            <button class="button primary" type="submit">
              Save all changes
            </button>
            <button class="button secondary" type="button"
              data-toggle-menu="${item.menu_item_id}"
              data-available="${item.is_available}">
              ${item.is_available ? "Hide item" : "Make available"}
            </button>
          </div>
        </form>
      </div>
    </article>
  `).join("");

  root.querySelectorAll("[data-edit-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (state.profile?.role !== "staff") return;

      const id = Number(form.dataset.editForm);
      const name = $(`edit-name-${id}`).value.trim();
      const description = $(`edit-description-${id}`).value.trim();
      const price = Number($(`edit-price-${id}`).value);
      const stock = Number($(`edit-stock-${id}`).value);
      const photo = $(`edit-photo-${id}`).files?.[0] || null;

      if (
        !name ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        message(
          "staff-menu-message",
          "Enter a valid name, price, and whole-number stock.",
          true
        );
        return;
      }

      if (photo && (
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(photo.type) ||
        photo.size > 5 * 1024 * 1024
      )) {
        message(
          "staff-menu-message",
          "Choose a JPG, PNG, WebP, or GIF image up to 5 MB.",
          true
        );
        return;
      }

      const originalItem = data.find(
        item => Number(item.menu_item_id) === id
      );

      let image_url = originalItem?.image_url || null;

      if (photo) {
        const safeName = photo.name
          .toLowerCase()
          .replace(/[^a-z0-9._-]/g, "-");

        const path = `${state.user.id}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await db.storage
          .from("menu-photos")
          .upload(path, photo, {
            contentType: photo.type,
            cacheControl: "3600",
            upsert: false
          });

        if (uploadError) {
          message("staff-menu-message", report(uploadError), true);
          return;
        }

        image_url = db.storage
          .from("menu-photos")
          .getPublicUrl(path).data.publicUrl;
      }

      const { error: updateError } = await db
        .from("menu_items")
        .update({
          name,
          description,
          price,
          stock_quantity: stock,
          image_url
        })
        .eq("menu_item_id", id);

      if (updateError) {
        message("staff-menu-message", report(updateError), true);
        return;
      }

      message("staff-menu-message", `${name} updated successfully.`);

      await loadMenu();
      await renderStaffMenu();
    });
  });

  root.querySelectorAll("[data-toggle-menu]").forEach(button => {
    button.addEventListener("click", async () => {
      if (state.profile?.role !== "staff") return;

      const id = Number(button.dataset.toggleMenu);
      const currentlyAvailable = button.dataset.available === "true";

      const { error: updateError } = await db
        .from("menu_items")
        .update({ is_available: !currentlyAvailable })
        .eq("menu_item_id", id);

      if (updateError) {
        message("staff-menu-message", report(updateError), true);
        return;
      }

      message(
        "staff-menu-message",
        currentlyAvailable
          ? "Menu item hidden from customers."
          : "Menu item is now available to customers."
      );

      await loadMenu();
      await renderStaffMenu();
    });
  });
}

async function addMenuItem(event) {
  event.preventDefault();
  message("staff-menu-message", "");

  if (state.profile?.role !== "staff") {
    message("staff-menu-message", "Staff access is required.", true);
    return;
  }

  const name = $("new-meal-name").value.trim();
  const description = $("new-meal-description").value.trim();
  const price = Number($("new-meal-price").value);
  const stock = Number($("new-meal-stock").value);
  const photo = $("new-meal-photo").files?.[0] || null;

  if (
    !name ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    message(
      "staff-menu-message",
      "Enter a valid name, price, and stock.",
      true
    );
    return;
  }

  if (photo && (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(photo.type) ||
    photo.size > 5 * 1024 * 1024
  )) {
    message(
      "staff-menu-message",
      "Choose a JPG, PNG, WebP, or GIF image up to 5 MB.",
      true
    );
    return;
  }

  let image_url = null;

  if (photo) {
    const safeName = photo.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-");

    const path = `${state.user.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await db.storage
      .from("menu-photos")
      .upload(path, photo, {
        contentType: photo.type,
        cacheControl: "3600",
        upsert: false
      });

    if (uploadError) {
      message("staff-menu-message", report(uploadError), true);
      return;
    }

    image_url = db.storage
      .from("menu-photos")
      .getPublicUrl(path).data.publicUrl;
  }

  const { error } = await db.from("menu_items").insert({
    name,
    description,
    price,
    stock_quantity: stock,
    is_available: true,
    image_url
  });

  if (error) {
    message("staff-menu-message", report(error), true);
    return;
  }

  $("add-menu-form").reset();

  message("staff-menu-message", "Menu item added successfully.");

  await loadMenu();
  await renderStaffMenu();
}

/* STAFF ORDER MONITORING */

function allowedNextStatuses(status) {
  if (status === "Pending") {
    return ["Preparing", "Cancelled"];
  }

  if (status === "Preparing") {
    return ["Ready for Pickup", "Cancelled"];
  }

  if (status === "Ready for Pickup") {
    return ["Completed"];
  }

  return [];
}

async function loadStaffOrders() {
  if (state.profile?.role !== "staff") return;

  const root = $("staff-orders-list");

  const { data: orders, error } = await db
  .from("orders")
  .select(`
    order_id,
    customer_id,
    pickup_at,
    status,
    created_at,
    profiles (
      display_name
    )
  `)
  .order("created_at", { ascending: false })
  .limit(100);

  if (error) {
    root.innerHTML =
      `<p class="message error">${safe(report(error))}</p>`;
    return;
  }

  if (!orders?.length) {
    root.innerHTML =
      '<div class="empty-state">No customer orders yet.</div>';
    return;
  }

  const html = [];

  for (const order of orders) {
    const { data: lines, error: lineError } = await db
      .from("order_items")
      .select("quantity,unit_price,menu_items(name)")
      .eq("order_id", order.order_id);

    const choices = allowedNextStatuses(order.status);

    html.push(`
      <article class="staff-order">
        <div class="staff-order-top">
          <div>
            <h3>Order #${order.order_id}</h3>
            <div class="order-meta">
              Pickup: ${safe(dateText(order.pickup_at))}<br>
              Submitted: ${safe(dateText(order.created_at))}
            </div>
          </div>
          <span class="status-pill status-${statusClass(order.status)}">
            ${safe(order.status)}
          </span>
        </div>

        <p class="order-meta">
          Customer: ${safe(
            order.profiles?.display_name || "Unknown Customer"
          )}
          </p>

        ${lineError
          ? `<p class="message error">${safe(lineError.message)}</p>`
          : `<div class="order-items">${(lines || []).map(line =>
              `${safe(line.menu_items?.name || "Meal")} × ${line.quantity} — ${money(Number(line.unit_price) * Number(line.quantity))}`
            ).join("<br>")}</div>`}

        ${choices.length ? `
          <div class="staff-order-controls">
            <select id="status-${order.order_id}"
              aria-label="Update order ${order.order_id}">
              <option value="">Choose status</option>
              ${choices.map(choice =>
                `<option value="${safe(choice)}">${safe(choice)}</option>`
              ).join("")}
            </select>
            <button class="button primary" type="button"
              data-update-order="${order.order_id}">
              Update order
            </button>
          </div>
        ` : ""}
      </article>
    `);
  }

  root.innerHTML = html.join("");

  root.querySelectorAll("[data-update-order]").forEach(button => {
    button.addEventListener("click", async () => {
      if (state.profile?.role !== "staff") return;

      const id = Number(button.dataset.updateOrder);
      const status = $(`status-${id}`).value;

      if (!status) {
        showOrderMessage("Choose a status first.", true);
        return;
      }

      const { error } = await db.rpc("update_order_status", {
        p_order_id: id,
        p_new_status: status
      });

      if (error) {
        showOrderMessage(report(error), true);
        return;
      }

      showOrderMessage(`Order #${id} updated to ${status}.`);
      await loadStaffOrders();
    });
  });
}

function showOrderMessage(text, error = false) {
  let node = $("staff-order-message");

  if (!node) {
    node = document.createElement("p");
    node.id = "staff-order-message";
    node.className = "message";
    $("staff-orders-list").before(node);
  }

  node.textContent = text;
  node.classList.toggle("error", error);
}

/* EVENT LISTENERS */

function connectEvents() {
  $("auth-form").addEventListener("submit", signIn);
  $("signup-btn").addEventListener("click", signUp);
  $("signout-btn").addEventListener("click", signOut);

  $("refresh-menu-btn").addEventListener("click", loadMenu);
  $("refresh-orders-btn").addEventListener("click", loadCustomerOrders);
  $("place-order-btn").addEventListener("click", placeOrder);

  $("add-menu-form").addEventListener("submit", addMenuItem);
  $("refresh-staff-menu-btn").addEventListener("click", renderStaffMenu);
  $("refresh-staff-orders-btn").addEventListener("click", loadStaffOrders);
}

/* START APPLICATION */

async function start() {
  connectEvents();
  setPickupDefault();

  if (
    SUPABASE_URL.includes("YOUR_PROJECT") ||
    SUPABASE_PUBLISHABLE_KEY.includes("YOUR_SUPABASE")
  ) {
    message(
      "menu-message",
      "Configure your Supabase URL and publishable key in app.js."
    );
    return;
  }

  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;

    state.user = data.session?.user || null;

    await getProfile();
    await updateInterface();
    await loadMenu();

    db.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;

      setTimeout(async () => {
        try {
          await getProfile();
          await updateInterface();
          await loadMenu();
        } catch (error) {
          console.error(error);
        }
      }, 0);
    });
  } catch (error) {
    message("menu-message", report(error), true);
  }
}

start();