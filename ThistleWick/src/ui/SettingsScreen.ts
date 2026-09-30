/**
 * 设置界面。
 *
 * I. 即时生效，而不是"确定/取消"
 *
 * 1. 滑块拖动的意义就在于实时看到画面变化；如果还需要按"应用"，玩家就得靠记忆
 *    比较两次效果。因此每次 `input` 事件都通过 `onChange(patch)` 立刻上报。
 * 2. 没有"取消"，但必须有"恢复默认"：把 `DEFAULT_SETTINGS` 整体作为一次 patch
 *    上报，语义与逐项修改完全一致，调用方不需要额外接口。
 *
 * II. 单位与读数的写法
 *
 * 每一项都在控件右侧实时显示当前值，且带单位（`75°`、`8 区块`、`80%`）。数字用
 * 等宽表格数字排版，拖动时数值宽度不跳变，行不会左右抖动。
 *
 * III. 组件不持久化
 *
 * 保存到 `localStorage` 是 settings 层的事；这里只调用 `onChange`，因此本组件
 * 在 jsdom 里可以用一个 spy 完整测试。
 *
 * @module ui/SettingsScreen
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  type GameSettings,
  type GraphicsQuality,
} from '@/settings/types';

import { createButton, createEl } from './dom';
import { ModalScreen, type ModalScreenOptions } from './ModalScreen';

/** 以滑块呈现的数值型设置。 */
export type NumericSettingKey =
  'mouseSensitivity' | 'fov' | 'renderDistance' | 'masterVolume' | 'sfxVolume' | 'ambientVolume';

/** 以开关呈现的布尔型设置。 */
export type ToggleSettingKey = 'shadows' | 'debugOverlay' | 'viewBobbing' | 'invertY';

export interface SettingsScreenOptions extends ModalScreenOptions {
  /**
   * 任一项发生变化时调用，参数是"只包含变化字段"的补丁。
   *
   * @param patch - 可直接交给 `applySettingsPatch` 的局部设置。
   */
  readonly onChange: (patch: Partial<GameSettings>) => void;
  /** 返回上一级；省略时隐藏返回按钮。 */
  readonly onBack?: () => void;
}

interface NumberFieldSpec {
  readonly key: NumericSettingKey;
  readonly label: string;
  readonly hint: string;
  readonly step: number;
  /** 读数的显示方式，含单位。 */
  readonly format: (value: number) => string;
}

interface ToggleFieldSpec {
  readonly key: ToggleSettingKey;
  readonly label: string;
  readonly hint: string;
}

interface QualitySpec {
  readonly value: GraphicsQuality;
  readonly label: string;
  readonly hint: string;
}

/** 分组顺序即界面顺序：先操作、再画面、最后音频。 */
const OPERATION_FIELDS: readonly NumberFieldSpec[] = [
  {
    key: 'mouseSensitivity',
    label: 'Mouse Sensitivity',
    hint: 'Measured in rad/px. Move right for faster turning or lower it for finer aim.',
    step: 0.0001,
    format: (value) => value.toFixed(4),
  },
];

const VIDEO_FIELDS: readonly NumberFieldSpec[] = [
  {
    key: 'fov',
    label: 'Field of View (FOV)',
    hint: '50° is focused and 110° is wide. A narrower view makes distant details easier to see.',
    step: 1,
    format: (value) => `${Math.round(value)}°`,
  },
  {
    key: 'renderDistance',
    label: 'Render Distance',
    hint: 'Measured in chunks. This setting has the greatest effect on frame rate.',
    step: 1,
    format: (value) => `${Math.round(value)} chunks`,
  },
];

const AUDIO_FIELDS: readonly NumberFieldSpec[] = [
  {
    key: 'masterVolume',
    label: 'Master Volume',
    hint: 'Overall output for all sound. Set to 0% to mute.',
    step: 0.05,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: 'sfxVolume',
    label: 'Effects Volume',
    hint: 'One-shot sounds such as mining, placing blocks, and footsteps.',
    step: 0.05,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: 'ambientVolume',
    label: 'Ambient Volume',
    hint: 'Looping background sounds such as wind and water.',
    step: 0.05,
    format: (value) => `${Math.round(value * 100)}%`,
  },
];

const VIDEO_TOGGLES: readonly ToggleFieldSpec[] = [
  {
    key: 'shadows',
    label: 'Shadows',
    hint: 'Turn off for a significant performance boost. Always disabled on Low.',
  },
  {
    key: 'viewBobbing',
    label: 'View Bobbing',
    hint: 'Adds subtle camera motion while walking. Disable it to reduce motion sickness.',
  },
  {
    key: 'debugOverlay',
    label: 'Debug Overlay',
    hint: 'Shows frame rate, chunk counts, and rendering statistics.',
  },
];

const OPERATION_TOGGLES: readonly ToggleFieldSpec[] = [
  {
    key: 'invertY',
    label: 'Invert Y Axis',
    hint: 'Moving the mouse up looks down, matching flight simulator controls.',
  },
];

const QUALITY_OPTIONS: readonly QualitySpec[] = [
  {
    value: 'low',
    label: 'Low',
    hint: '1.0 pixel ratio, no antialiasing, and no shadows for older devices.',
  },
  {
    value: 'medium',
    label: 'Medium',
    hint: '1.5 pixel ratio with antialiasing for a balanced default.',
  },
  {
    value: 'high',
    label: 'High',
    hint: '2.0 pixel ratio and 2048px shadow maps for visual quality.',
  },
];

const ROOT_CLASS = 'settings';

/** 把数值型设置的改动包成一个类型安全的补丁。 */
function numericPatch(key: NumericSettingKey, value: number): Partial<GameSettings> {
  switch (key) {
    case 'mouseSensitivity':
      return { mouseSensitivity: value };
    case 'fov':
      return { fov: value };
    case 'renderDistance':
      return { renderDistance: value };
    case 'masterVolume':
      return { masterVolume: value };
    case 'sfxVolume':
      return { sfxVolume: value };
    case 'ambientVolume':
      return { ambientVolume: value };
  }
}

/** 把开关型设置的改动包成一个类型安全的补丁。 */
function togglePatch(key: ToggleSettingKey, value: boolean): Partial<GameSettings> {
  switch (key) {
    case 'shadows':
      return { shadows: value };
    case 'debugOverlay':
      return { debugOverlay: value };
    case 'viewBobbing':
      return { viewBobbing: value };
    case 'invertY':
      return { invertY: value };
  }
}

export class SettingsScreen extends ModalScreen {
  readonly #inputs = new Map<NumericSettingKey, HTMLInputElement>();
  readonly #readouts = new Map<NumericSettingKey, HTMLElement>();
  readonly #toggles = new Map<
    ToggleSettingKey,
    { readonly button: HTMLButtonElement; readonly text: HTMLElement }
  >();
  readonly #qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  /**
   * 画质预设的说明文字。
   *
   * 在字段初始化器里创建（而不是在构造函数体内）：字段初始化器先于构造函数体
   * 执行，因此 `#buildVideoSection()` 被调用时它已经存在，可以直接挂进 DOM。
   */
  readonly #qualityHint: HTMLElement = createEl('p', {
    className: `${ROOT_CLASS}__hint`,
    testId: 'settings-quality-hint',
  });
  readonly #onChange: (patch: Partial<GameSettings>) => void;
  #settings: GameSettings = DEFAULT_SETTINGS;

  public constructor(root: HTMLElement, options: SettingsScreenOptions) {
    super(
      root,
      { className: ROOT_CLASS, testId: 'settings-screen', ariaLabel: 'Settings' },
      options,
    );

    this.#onChange = options.onChange;

    const header = createEl('header', { className: 'menu-header menu-header--compact' });
    header.append(
      createEl('h2', {
        className: 'menu-header__title',
        text: 'Settings',
        testId: 'settings-title',
      }),
      createEl('p', {
        className: 'menu-header__subtitle',
        text: 'Changes apply immediately and save automatically.',
      }),
    );

    const body = createEl('div', { className: `${ROOT_CLASS}__body` });
    body.append(
      this.#buildNumberSection('Controls', OPERATION_FIELDS, OPERATION_TOGGLES),
      this.#buildVideoSection(),
      this.#buildNumberSection('Audio', AUDIO_FIELDS, []),
    );

    const footer = createEl('footer', { className: 'menu-footer menu-footer--row' });
    const resetButton = createButton('Restore Defaults', {
      className: 'menu-button menu-button--ghost',
      testId: 'settings-reset',
    });
    resetButton.addEventListener('click', () => {
      // 整体重置与单项修改走同一条路径，调用方无需区分。
      this.#onChange({ ...DEFAULT_SETTINGS });
    });
    const backButton = createButton('Back', {
      className: 'menu-button',
      testId: 'settings-back',
    });
    backButton.addEventListener('click', () => {
      options.onBack?.();
    });
    backButton.hidden = options.onBack === undefined;
    footer.append(resetButton, backButton);

    this.card.append(header, body, footer);

    this.update(DEFAULT_SETTINGS);
  }

  /** 当前被渲染的设置（只读副本的引用）。 */
  public get settings(): GameSettings {
    return this.#settings;
  }

  /**
   * 用最新设置刷新所有控件。
   *
   * @param settings - 已归一化的完整设置对象。
   */
  public update(settings: GameSettings): void {
    this.#settings = settings;

    for (const field of ALL_NUMBER_FIELDS) {
      const value = settings[field.key];
      const input = this.#inputs.get(field.key);
      if (input !== undefined) {
        input.value = String(value);
        // 读屏软件读数字时不会带上单位，因此显式提供口语化读数。
        input.setAttribute('aria-valuetext', field.format(value));
      }
      const readout = this.#readouts.get(field.key);
      if (readout !== undefined) {
        readout.textContent = field.format(value);
      }
    }

    for (const field of ALL_TOGGLE_FIELDS) {
      const entry = this.#toggles.get(field.key);
      if (entry === undefined) {
        continue;
      }
      const on = settings[field.key];
      entry.button.setAttribute('aria-checked', String(on));
      entry.button.classList.toggle('toggle--on', on);
      entry.button.dataset['state'] = on ? 'on' : 'off';
      entry.text.textContent = on ? 'On' : 'Off';
    }

    for (const option of QUALITY_OPTIONS) {
      const button = this.#qualityButtons.get(option.value);
      if (button === undefined) {
        continue;
      }
      const active = settings.graphicsQuality === option.value;
      button.classList.toggle('segmented__option--active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    const activeQuality = QUALITY_OPTIONS.find(
      (option) => option.value === settings.graphicsQuality,
    );
    this.#qualityHint.textContent = activeQuality?.hint ?? '';
  }

  /** 一个区块：若干滑块 + 若干开关。 */
  #buildNumberSection(
    title: string,
    fields: readonly NumberFieldSpec[],
    toggles: readonly ToggleFieldSpec[],
  ): HTMLElement {
    const section = createEl('section', { className: `${ROOT_CLASS}__section` });
    section.append(createEl('h3', { className: `${ROOT_CLASS}__section-title`, text: title }));

    for (const field of fields) {
      section.append(this.#buildNumberField(field));
    }
    for (const toggle of toggles) {
      section.append(this.#buildToggleField(toggle));
    }
    return section;
  }

  /** 画面区块：画质预设 + 滑块 + 开关。 */
  #buildVideoSection(): HTMLElement {
    const section = createEl('section', { className: `${ROOT_CLASS}__section` });
    section.append(createEl('h3', { className: `${ROOT_CLASS}__section-title`, text: 'Video' }));

    const qualityField = createEl('div', { className: `${ROOT_CLASS}__field` });
    qualityField.append(
      createEl('span', { className: `${ROOT_CLASS}__label`, text: 'Quality Preset' }),
    );
    const segmented = createEl('div', {
      className: 'segmented',
      testId: 'settings-quality',
    });
    segmented.setAttribute('role', 'group');
    segmented.setAttribute('aria-label', 'Quality preset');
    for (const option of QUALITY_OPTIONS) {
      const button = createButton(option.label, {
        className: 'segmented__option',
        testId: `settings-quality-${option.value}`,
      });
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        this.#onChange({ graphicsQuality: option.value });
      });
      this.#qualityButtons.set(option.value, button);
      segmented.append(button);
    }
    qualityField.append(segmented, this.#qualityHint);
    section.append(qualityField);

    for (const field of VIDEO_FIELDS) {
      section.append(this.#buildNumberField(field));
    }
    for (const toggle of VIDEO_TOGGLES) {
      section.append(this.#buildToggleField(toggle));
    }
    return section;
  }

  /** 一行滑块：标签 + 实时读数 + 控件 + 说明。 */
  #buildNumberField(field: NumberFieldSpec): HTMLElement {
    const limits = SETTINGS_LIMITS[field.key];
    const wrapper = createEl('div', { className: `${ROOT_CLASS}__field` });
    wrapper.dataset['key'] = field.key;

    const head = createEl('div', { className: `${ROOT_CLASS}__field-head` });
    const label = createEl('label', { className: `${ROOT_CLASS}__label`, text: field.label });
    const readout = createEl('span', {
      className: `${ROOT_CLASS}__value`,
      testId: `settings-${field.key}-value`,
    });
    const inputId = `settings-input-${field.key}`;
    label.htmlFor = inputId;
    head.append(label, readout);

    const input = createEl('input', {
      className: `${ROOT_CLASS}__range`,
      testId: `settings-${field.key}`,
    });
    input.type = 'range';
    input.id = inputId;
    input.min = String(limits.min);
    input.max = String(limits.max);
    input.step = String(field.step);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) {
        this.#onChange(numericPatch(field.key, value));
      }
    });

    wrapper.append(
      head,
      input,
      createEl('p', { className: `${ROOT_CLASS}__hint`, text: field.hint }),
    );

    this.#inputs.set(field.key, input);
    this.#readouts.set(field.key, readout);
    return wrapper;
  }

  /** 一行开关：标签 + `role="switch"` 按钮 + 说明。 */
  #buildToggleField(field: ToggleFieldSpec): HTMLElement {
    const wrapper = createEl('div', {
      className: `${ROOT_CLASS}__field ${ROOT_CLASS}__field--row`,
    });
    wrapper.dataset['key'] = field.key;

    const button = createButton('', {
      className: 'toggle',
      testId: `settings-${field.key}-toggle`,
    });
    // 用 `role="switch"` 而不是 checkbox：它是"立即生效的开关"，没有表单提交语义。
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', 'false');
    const text = createEl('span', { className: 'toggle__text', text: 'Off' });
    button.append(text);
    button.addEventListener('click', () => {
      this.#onChange(togglePatch(field.key, !this.#settings[field.key]));
    });

    const head = createEl('div', { className: `${ROOT_CLASS}__field-head` });
    head.append(createEl('span', { className: `${ROOT_CLASS}__label`, text: field.label }), button);

    wrapper.append(head, createEl('p', { className: `${ROOT_CLASS}__hint`, text: field.hint }));

    this.#toggles.set(field.key, { button, text });
    return wrapper;
  }
}

const ALL_NUMBER_FIELDS: readonly NumberFieldSpec[] = [
  ...OPERATION_FIELDS,
  ...VIDEO_FIELDS,
  ...AUDIO_FIELDS,
];

const ALL_TOGGLE_FIELDS: readonly ToggleFieldSpec[] = [...OPERATION_TOGGLES, ...VIDEO_TOGGLES];

/** 供集成方核对：这些键都由本界面覆盖。 */
export const SETTINGS_SCREEN_KEYS = {
  numeric: ALL_NUMBER_FIELDS.map((field) => field.key),
  toggles: ALL_TOGGLE_FIELDS.map((field) => field.key),
} as const;

export { QUALITY_OPTIONS };
