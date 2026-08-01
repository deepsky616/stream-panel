import { useEffect, useRef, useState } from 'react';
import type { IconSpec } from '../../../shared/types';

const EMOJIS = `😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😎 🤓 🥳 🤩 😍 🥰 😇 🤠 🤖 👻 👽 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🦄 🐝 🦋 🌸 🌻 🌞 🌙 ⭐ 🌈 🔥 💧 ❄️ ⚡ 🍎 🍊 🍋 🍇 🍓 🍒 🥝 🍔 🍕 🍿 ☕ 🍺 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏆 🎮 🎲 🎯 🎸 🎹 🎧 🎤 🎬 🚗 🚕 🚌 🚀 ✈️ 🚲 🏠 🏢 🏥 🏫 💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📷 📹 💡 🔦 📚 📁 📄 📌 📅 🔍 🔗 🔒 🔓 🔔 ⚙️ 🛠️ ✉️ ❤️ 💙 💚 💛 ✅ ❌ ➕ ➖ ▶️ ⏸️ ⏹️ ⏭️ 🔀 🔁 ⬆️ ⬇️ ⬅️ ➡️`.split(' ');

type Tab = 'auto' | 'emoji' | 'image' | 'letter';

export function IconPicker({ icon, onChange }: { icon: IconSpec; onChange: (icon: IconSpec) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(icon.kind === 'file' ? 'image' : icon.kind);
  const [directEmoji, setDirectEmoji] = useState(icon.kind === 'emoji' ? icon.value : '');
  const [letter, setLetter] = useState(icon.kind === 'letter' ? icon.value : 'A');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab' || !popoverRef.current) return;
      const focusable = Array.from(
        popoverRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const chooseImage = async () => {
    const path = await window.api.picker.image();
    if (path) {
      onChange({ kind: 'file', path });
      setOpen(false);
    }
  };

  return (
    <div className="icon-picker">
      <button type="button" onClick={() => setOpen((value) => !value)}>
        아이콘 변경
      </button>
      {open && (
        <div ref={popoverRef} className="icon-popover" role="dialog" aria-label="아이콘 선택">
          <div className="icon-tabs" role="tablist">
            {([
              ['auto', '자동'],
              ['emoji', '이모지'],
              ['image', '이미지'],
              ['letter', '글자'],
            ] as Array<[Tab, string]>).map(([value, label]) => (
              <button
                key={value}
                className={tab === value ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'auto' && (
            <div className="icon-tab-panel">
              <p>대상에서 아이콘을 자동으로 가져옵니다.</p>
              <button type="button" onClick={() => { onChange({ kind: 'auto' }); setOpen(false); }}>
                자동 아이콘 사용
              </button>
            </div>
          )}
          {tab === 'emoji' && (
            <div className="icon-tab-panel">
              <div className="emoji-grid">
                {EMOJIS.map((emoji, index) => (
                  <button
                    key={`${emoji}-${index}`}
                    type="button"
                    onClick={() => { onChange({ kind: 'emoji', value: emoji }); setOpen(false); }}
                    aria-label={`${emoji} 이모지 선택`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <span className="direct-icon-input">
                <input value={directEmoji} maxLength={16} onChange={(event) => setDirectEmoji(event.target.value)} />
                <button
                  type="button"
                  onClick={() => { if (directEmoji) onChange({ kind: 'emoji', value: directEmoji }); setOpen(false); }}
                >
                  적용
                </button>
              </span>
            </div>
          )}
          {tab === 'image' && (
            <div className="icon-tab-panel">
              <p>144×144 크기의 정사각형 이미지를 권장합니다. 다른 크기는 자동으로 맞춥니다.</p>
              <button type="button" onClick={() => void chooseImage()}>이미지 선택</button>
            </div>
          )}
          {tab === 'letter' && (
            <div className="icon-tab-panel">
              <p>키에 표시할 한두 글자를 입력하세요.</p>
              <span className="direct-icon-input">
                <input value={letter} maxLength={2} onChange={(event) => setLetter(event.target.value)} />
                <button
                  type="button"
                  onClick={() => { if (letter) onChange({ kind: 'letter', value: letter }); setOpen(false); }}
                >
                  적용
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
