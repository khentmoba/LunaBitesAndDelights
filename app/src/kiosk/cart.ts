// The order being built, as lib/services/cart_notifier.dart keeps it. Kept in
// sessionStorage so it survives moving between the kiosk pages in one tab.

export interface CartItem {
  id: string;
  name: string;
  emoji: string;
  imageUrl: string;
  variant: string;
  price: number;
  quantity: number;
}

const KEY = 'luna.cart';
const EVENT = 'luna:cart';

function read(): CartItem[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const items: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? (items as CartItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage blocked (private mode): the cart lives for this page only.
  }
  memory = items;
  window.dispatchEvent(new CustomEvent(EVENT));
}

let memory: CartItem[] | null = null;
const items = (): CartItem[] => memory ?? (memory = read());

export const cart = {
  items: (): readonly CartItem[] => items(),
  totalCount: (): number => items().reduce((s, i) => s + i.quantity, 0),
  totalPrice: (): number => items().reduce((s, i) => s + i.price * i.quantity, 0),

  /** Same name and variant adds to the existing line. */
  add(item: CartItem): void {
    const next = items().map((i) => ({ ...i }));
    const existing = next.find((c) => c.name === item.name && c.variant === item.variant);
    if (existing) existing.quantity += item.quantity;
    else next.push({ ...item });
    write(next);
  },

  remove(id: string): void {
    write(items().filter((c) => c.id !== id));
  },

  increment(id: string): void {
    write(items().map((c) => (c.id === id ? { ...c, quantity: c.quantity + 1 } : c)));
  },

  decrement(id: string): void {
    const next: CartItem[] = [];
    for (const c of items()) {
      if (c.id !== id) next.push(c);
      else if (c.quantity > 1) next.push({ ...c, quantity: c.quantity - 1 });
    }
    write(next);
  },

  clear(): void {
    write([]);
  },

  /** Runs now and after every change. */
  subscribe(fn: () => void): void {
    window.addEventListener(EVENT, fn);
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) {
        memory = null;
        fn();
      }
    });
    fn();
  },
};

export const peso = (n: number): string => `₱${n}`;
