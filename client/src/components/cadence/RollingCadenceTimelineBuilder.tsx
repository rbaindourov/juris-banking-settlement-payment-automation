import React, { useState, useRef, useEffect } from 'react';
import {
  Clock,
  Send,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Calendar,
  Globe,
  Tag,
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
  Eye,
  Copy,
  Check,
  LucideIcon
} from 'lucide-react';
import {
  CadenceStageKey,
  ICadenceStage,
  ILocalizedTemplate,
  INotificationCadence
} from '../../types/cadence';
import { TemplatePreviewModal } from '../TemplatePreviewModal';
import { caseApi } from '../../services/api';

export interface RollingCadenceTimelineBuilderProps {
  stages?: ICadenceStage[];
  cadence?: INotificationCadence;
  onChange: (updated: any) => void;
  deadlineDate?: string | Date;
  caseName?: string;
  caseId?: string;
  readOnly?: boolean;
  supportedLanguages?: string[];
}

export const MERGE_TAGS = [
  { tag: '{{claimant_first_name}}', label: 'First Name', sample: 'Jonathan' },
  { tag: '{{settlement_amount}}', label: 'Amount ($)', sample: '$450.00' },
  { tag: '{{selection_deadline}}', label: 'Deadline', sample: 'November 30, 2026' },
  { tag: '{{payment_selection_link}}', label: 'Magic Link', sample: 'https://portal.juris-banking.com/claim/0123' },
  { tag: '{{claimant_last_name}}', label: 'Last Name', sample: 'Doe' },
  { tag: '{{case_name}}', label: 'Case Docket', sample: 'In re Apex Privacy Settlement' }
];

export const STAGE_CONFIGS: Record<
  CadenceStageKey,
  {
    stageNumber: number;
    shortTitle: string;
    defaultOffsetHours: number;
    offsetLabel: string;
    icon: LucideIcon;
    colorVar: string;
    badgeClass: string;
    description: string;
  }
> = {
  initial_notice: {
    stageNumber: 1,
    shortTitle: 'Initial Notice',
    defaultOffsetHours: 0,
    offsetLabel: 'Immediate / Launch',
    icon: Send,
    colorVar: 'var(--color-indigo)',
    badgeClass: 'status-pill-indigo',
    description: 'Court-approved formal notice sent at campaign launch inviting claimants to select payment options.'
  },
  reminder_14d: {
    stageNumber: 2,
    shortTitle: '14-Day Reminder',
    defaultOffsetHours: -336,
    offsetLabel: 'T-14 Days (-336h)',
    icon: Clock,
    colorVar: 'var(--color-primary)',
    badgeClass: 'status-pill-active',
    description: 'First reminder wave alerting unselected claimants that 2 weeks remain before deadline.'
  },
  urgent_warning_7d: {
    stageNumber: 3,
    shortTitle: '7-Day Warning',
    defaultOffsetHours: -168,
    offsetLabel: 'T-7 Days (-168h)',
    icon: AlertTriangle,
    colorVar: 'var(--color-warning)',
    badgeClass: 'status-pill-warning',
    description: 'Urgent notice warning unselected claimants of the 7-day cutoff window.'
  },
  final_notice_48h: {
    stageNumber: 4,
    shortTitle: '48-Hour Final',
    defaultOffsetHours: -48,
    offsetLabel: 'T-48 Hours (-48h)',
    icon: AlertOctagon,
    colorVar: 'var(--color-danger)',
    badgeClass: 'status-pill-danger',
    description: 'Final critical notification warning of immediate court-mandated fallback assignment.'
  },
  post_deadline_fallback: {
    stageNumber: 5,
    shortTitle: 'Post-Deadline Notice',
    defaultOffsetHours: 24,
    offsetLabel: 'Post-Deadline (+24h)',
    icon: CheckCircle2,
    colorVar: 'var(--color-success)',
    badgeClass: 'status-pill-success',
    description: 'Post-expiration confirmation detailing the assigned default fallback payment rail.'
  }
};

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English (EN)' },
  { code: 'es', label: 'Español (ES)' },
  { code: 'zh', label: '中文 (ZH)' },
  { code: 'vi', label: 'Tiếng Việt (VI)' }
];

export const RollingCadenceTimelineBuilder: React.FC<RollingCadenceTimelineBuilderProps> = ({
  stages: propsStages,
  cadence: propsCadence,
  onChange,
  deadlineDate,
  caseName = 'Settlement Administration',
  caseId = '',
  readOnly = false,
  supportedLanguages = ['en', 'es', 'zh', 'vi']
}) => {
  const currentStages: ICadenceStage[] = propsStages || propsCadence?.stages || [];

  const [activeStageIndex, setActiveStageIndex] = useState<number>(0);
  const [activeLang, setActiveLang] = useState<string>('en');
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');

  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [copiedEnglish, setCopiedEnglish] = useState<boolean>(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const currentStage: ICadenceStage | undefined = currentStages[activeStageIndex] || currentStages[0];
  const stageKey: CadenceStageKey = (currentStage?.stageKey as CadenceStageKey) || 'initial_notice';
  const currentConfig = STAGE_CONFIGS[stageKey] || STAGE_CONFIGS.initial_notice;
  const currentTemplate: ILocalizedTemplate = currentStage?.templates?.[activeLang] || { subject: '', bodyHtml: '' };

  // Synchronize editor innerHTML when active stage or language changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = currentTemplate.bodyHtml || '';
    }
  }, [activeStageIndex, activeLang, currentStage?.stageKey]);

  const emitChange = (newStages: ICadenceStage[]) => {
    if (readOnly) return;
    if (propsStages) {
      onChange(newStages);
    } else if (propsCadence) {
      onChange({
        ...propsCadence,
        stages: newStages
      });
    } else {
      onChange(newStages);
    }
  };

  const updateStage = (updated: Partial<ICadenceStage>) => {
    if (readOnly || !currentStage) return;
    const newStages = currentStages.map((st, i) => (i === activeStageIndex ? { ...st, ...updated } : st));
    emitChange(newStages);
  };

  const updateTemplate = (updates: Partial<ILocalizedTemplate>) => {
    if (readOnly || !currentStage) return;
    const newTemplates = {
      ...currentStage.templates,
      [activeLang]: {
        ...(currentStage.templates[activeLang] || { subject: '', bodyHtml: '' }),
        ...updates
      }
    };
    updateStage({ templates: newTemplates });
  };

  const handleBodyInput = () => {
    if (editorRef.current && !readOnly) {
      const html = editorRef.current.innerHTML;
      updateTemplate({ bodyHtml: html });
    }
  };

  const executeCommand = (command: string, value: string | undefined = undefined) => {
    if (readOnly) return;
    document.execCommand(command, false, value);
    handleBodyInput();
  };

  const insertMergeTag = (tag: string) => {
    if (readOnly) return;
    if (focusedField === 'subject' && subjectInputRef.current) {
      const input = subjectInputRef.current;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const val = input.value;
      const newVal = val.substring(0, start) + tag + val.substring(end);
      updateTemplate({ subject: newVal });
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('insertText', false, tag);
      handleBodyInput();
    }
  };

  const handleCloneEnglish = () => {
    if (readOnly || activeLang === 'en' || !currentStage) return;
    const enTemplate = currentStage.templates.en;
    if (!enTemplate) return;
    updateTemplate({
      subject: enTemplate.subject,
      bodyHtml: enTemplate.bodyHtml
    });
    if (editorRef.current) {
      editorRef.current.innerHTML = enTemplate.bodyHtml;
    }
    setCopiedEnglish(true);
    setTimeout(() => setCopiedEnglish(false), 2000);
  };

  const calculateDate = (stage: ICadenceStage): string => {
    if (stage.triggerType === 'date_fixed' && stage.fixedDate) {
      const d = new Date(stage.fixedDate);
      return isNaN(d.getTime()) ? 'Not scheduled' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (!deadlineDate) return 'Deadline TBD';
    const deadline = new Date(deadlineDate);
    if (isNaN(deadline.getTime())) return 'Invalid Deadline';
    const target = new Date(deadline.getTime() + stage.offsetHours * 3600 * 1000);
    return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleOpenPreview = async () => {
    setIsLoadingPreview(true);
    try {
      if (caseId) {
        const res = await caseApi.previewTemplate(caseId, {
          template: currentTemplate.bodyHtml,
          language: activeLang
        });
        setPreviewHtml(res.renderedHtml);
      } else {
        throw new Error('No caseId');
      }
    } catch {
      let fallbackHtml = currentTemplate.bodyHtml || '<p><em>No template content available.</em></p>';
      MERGE_TAGS.forEach(({ tag, sample }) => {
        fallbackHtml = fallbackHtml.split(tag).join(sample);
      });
      setPreviewHtml(fallbackHtml);
    } finally {
      setIsLoadingPreview(false);
      setPreviewOpen(true);
    }
  };

  const availableLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) => !supportedLanguages || supportedLanguages.length === 0 || supportedLanguages.includes(lang.code)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Five-Stage Timeline Stepper Track */}
      <div
        className="fintech-card"
        style={{
          padding: '20px',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: '#ffffff'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', margin: 0 }}>
              5-Stage Settlement Cadence Timeline
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Interactive settlement notification lifecycle. Select a stage to configure triggers, localized templates, and merge tags.
            </p>
          </div>
          {deadlineDate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <Calendar size={14} color="var(--color-indigo)" aria-hidden="true" />
              <span>
                Disbursement Deadline: <strong>{new Date(deadlineDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
              </span>
            </div>
          )}
        </div>

        {/* Stepper Grid Track */}
        <div
          role="tablist"
          aria-label="Settlement cadence stages"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: '12px',
            alignItems: 'stretch'
          }}
        >
          {currentStages.map((stage, idx) => {
            const config = STAGE_CONFIGS[stage.stageKey] || STAGE_CONFIGS.initial_notice;
            const IconComponent = config.icon;
            const isSelected = idx === activeStageIndex;
            const scheduledDateStr = calculateDate(stage);

            return (
              <button
                key={stage.stageKey}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={`Stage ${config.stageNumber}: ${config.shortTitle}`}
                onClick={() => setActiveStageIndex(idx)}
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-md)',
                  border: isSelected ? '2px solid var(--color-indigo)' : '1px solid var(--border-subtle)',
                  backgroundColor: isSelected ? 'var(--bg-active)' : stage.enabled ? '#ffffff' : 'var(--bg-card-subtle)',
                  opacity: stage.enabled ? 1 : 0.65,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  position: 'relative',
                  minHeight: '44px',
                  boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                  outline: 'none'
                }}
              >
                {/* Node Top: Icon & Offset Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: isSelected ? 'var(--color-indigo)' : '#f1f5f9',
                      color: isSelected ? '#ffffff' : config.colorVar,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 700
                    }}
                  >
                    <IconComponent size={14} aria-hidden={true} />
                  </div>
                  <span
                    className={`status-pill ${stage.enabled ? config.badgeClass : 'status-pill-neutral'}`}
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                  >
                    {stage.enabled ? config.offsetLabel : 'Disabled'}
                  </span>
                </div>

                {/* Node Title & Scheduled Date */}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Stage {config.stageNumber}: {config.shortTitle}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {scheduledDateStr}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Selected Stage Detail & Editor */}
      {currentStage && (
        <div
          className="fintech-card"
          style={{
            padding: '24px',
            border: '1px solid var(--border-card)',
            borderRadius: 'var(--radius-lg)',
            backgroundColor: '#ffffff'
          }}
        >
          {/* Stage Header & Activation Switch */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '16px',
              borderBottom: '1px solid var(--border-subtle)',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Stage {currentConfig.stageNumber}: {currentStage.stageName}
                </span>
                <span className={`status-pill ${currentStage.enabled ? currentConfig.badgeClass : 'status-pill-neutral'}`}>
                  {currentStage.enabled ? 'ACTIVE' : 'DISABLED'}
                </span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                {currentConfig.description}
              </p>
            </div>

            {/* Enable Toggle & Offset Setting */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                  minHeight: '44px'
                }}
              >
                <input
                  type="checkbox"
                  checked={currentStage.enabled}
                  disabled={readOnly}
                  onChange={(e) => updateStage({ enabled: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-indigo)', cursor: 'pointer' }}
                />
                <span>Enable Stage Wave</span>
              </label>

              {currentStage.triggerType === 'deadline_relative' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Offset (Hours):</span>
                  <input
                    type="number"
                    value={currentStage.offsetHours}
                    disabled={readOnly}
                    onChange={(e) => updateStage({ offsetHours: parseInt(e.target.value, 10) || 0 })}
                    className="fintech-input"
                    style={{ width: '90px', padding: '4px 8px', minHeight: '44px', fontSize: '13px' }}
                    aria-label={`Offset hours for ${currentStage.stageName}`}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 3. Localized Language Tab Strip */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            <div
              role="tablist"
              aria-label="Template localization languages"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'var(--bg-card-subtle)',
                padding: '4px',
                borderRadius: 'var(--radius-md)'
              }}
            >
              <Globe size={15} color="var(--text-muted)" style={{ margin: '0 6px' }} aria-hidden="true" />
              {availableLanguages.map(({ code, label }) => {
                const hasContent = Boolean(
                  currentStage.templates[code]?.subject?.trim() && currentStage.templates[code]?.bodyHtml?.trim()
                );
                return (
                  <button
                    key={code}
                    type="button"
                    role="tab"
                    aria-selected={activeLang === code}
                    onClick={() => setActiveLang(code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 14px',
                      minHeight: '44px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: 'none',
                      backgroundColor: activeLang === code ? '#ffffff' : 'transparent',
                      color: activeLang === code ? 'var(--color-primary)' : 'var(--text-muted)',
                      boxShadow: activeLang === code ? 'var(--shadow-xs)' : 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <span>{label}</span>
                    {hasContent && (
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: 'var(--radius-full)',
                          backgroundColor: 'var(--color-success)'
                        }}
                        title="Content configured"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Clone from English Helper */}
            {activeLang !== 'en' && (
              <button
                type="button"
                onClick={handleCloneEnglish}
                disabled={readOnly || !currentStage.templates.en}
                className="btn-secondary"
                style={{
                  padding: '6px 14px',
                  minHeight: '44px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Copy English Subject and Body HTML into this language tab"
              >
                {copiedEnglish ? <Check size={14} color="var(--color-success)" /> : <Copy size={14} />}
                <span>{copiedEnglish ? 'Copied English Content' : 'Clone from English'}</span>
              </button>
            )}
          </div>

          {/* 4. Subject Line Input */}
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="cadence-stage-subject"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: '6px'
              }}
            >
              Email Subject Line ({activeLang.toUpperCase()})
            </label>
            <input
              id="cadence-stage-subject"
              ref={subjectInputRef}
              type="text"
              value={currentTemplate.subject || ''}
              disabled={readOnly}
              onFocus={() => setFocusedField('subject')}
              onChange={(e) => updateTemplate({ subject: e.target.value })}
              placeholder="e.g. Court-Approved Settlement Notice: Payment Selection Required"
              className="fintech-input"
              style={{ width: '100%', minHeight: '44px' }}
            />
          </div>

          {/* 5. Rich Text Toolbar & Dynamic Merge Tag Pill Inserters */}
          <div
            style={{
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              backgroundColor: '#ffffff'
            }}
          >
            {/* Formatting Toolbar */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-card-subtle)',
                borderBottom: '1px solid var(--border-subtle)'
              }}
            >
              <button
                type="button"
                title="Bold"
                onClick={() => executeCommand('bold')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Format Bold"
              >
                <Bold size={15} />
              </button>
              <button
                type="button"
                title="Italic"
                onClick={() => executeCommand('italic')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Format Italic"
              >
                <Italic size={15} />
              </button>
              <button
                type="button"
                title="Underline"
                onClick={() => executeCommand('underline')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Format Underline"
              >
                <Underline size={15} />
              </button>

              <span style={dividerStyle} />

              <button
                type="button"
                title="Heading 1"
                onClick={() => executeCommand('formatBlock', '<h1>')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Format Heading 1"
              >
                <Heading1 size={15} />
              </button>
              <button
                type="button"
                title="Heading 2"
                onClick={() => executeCommand('formatBlock', '<h2>')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Format Heading 2"
              >
                <Heading2 size={15} />
              </button>

              <span style={dividerStyle} />

              <button
                type="button"
                title="Bullet List"
                onClick={() => executeCommand('insertUnorderedList')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Insert Bulleted List"
              >
                <List size={15} />
              </button>
              <button
                type="button"
                title="Numbered List"
                onClick={() => executeCommand('insertOrderedList')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Insert Numbered List"
              >
                <ListOrdered size={15} />
              </button>

              <span style={dividerStyle} />

              <button
                type="button"
                title="Insert Link"
                disabled={readOnly}
                onClick={() => {
                  const url = prompt('Enter URL (or merge tag):', '{{payment_selection_link}}');
                  if (url) executeCommand('createLink', url);
                }}
                style={toolbarButtonStyle}
                aria-label="Insert Hyperlink"
              >
                <LinkIcon size={15} />
              </button>
              <button
                type="button"
                title="Undo"
                onClick={() => executeCommand('undo')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Undo action"
              >
                <Undo size={15} />
              </button>
              <button
                type="button"
                title="Redo"
                onClick={() => executeCommand('redo')}
                style={toolbarButtonStyle}
                disabled={readOnly}
                aria-label="Redo action"
              >
                <Redo size={15} />
              </button>

              {/* Live Preview Button */}
              <div style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={handleOpenPreview}
                  disabled={isLoadingPreview}
                  className="btn-primary"
                  style={{
                    padding: '6px 14px',
                    minHeight: '44px',
                    fontSize: '12px',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Eye size={14} aria-hidden="true" />
                  <span>{isLoadingPreview ? 'Rendering...' : 'Live Preview'}</span>
                </button>
              </div>
            </div>

            {/* Merge Tag Pill Strip */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 14px',
                backgroundColor: '#ffffff',
                borderBottom: '1px solid var(--border-subtle)'
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginRight: '4px'
                }}
              >
                <Tag size={13} color="var(--color-indigo)" aria-hidden="true" />
                Merge Tags ({focusedField}):
              </span>
              {MERGE_TAGS.map(({ tag, label, sample }) => (
                <button
                  key={tag}
                  type="button"
                  disabled={readOnly}
                  onClick={() => insertMergeTag(tag)}
                  title={`Click to insert into ${focusedField}: ${label} (Sample: ${sample})`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    minHeight: '44px',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--bg-active)',
                    border: '1px solid #bfdbfe',
                    color: 'var(--color-indigo)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{tag}</span>
                </button>
              ))}
            </div>

            {/* WYSIWYG Content Editable Area */}
            <div
              ref={editorRef}
              contentEditable={!readOnly}
              onFocus={() => setFocusedField('body')}
              onInput={handleBodyInput}
              aria-label="Notification Stage Email Body Editor"
              style={{
                minHeight: '260px',
                maxHeight: '480px',
                overflowY: 'auto',
                padding: '18px',
                outline: 'none',
                fontSize: '14px',
                lineHeight: 1.6,
                color: 'var(--text-primary)'
              }}
            />
          </div>
        </div>
      )}

      {/* 6. Live Preview Modal */}
      <TemplatePreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        renderedHtml={previewHtml}
        caseName={caseName}
        supportedLanguages={availableLanguages.map((l) => l.code)}
        currentLanguage={activeLang}
        onLanguageChange={(l) => setActiveLang(l)}
      />
    </div>
  );
};

const toolbarButtonStyle: React.CSSProperties = {
  width: '36px',
  height: '44px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: '#ffffff',
  border: '1px solid var(--border-default)',
  color: 'var(--text-secondary)',
  cursor: 'pointer'
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '24px',
  backgroundColor: 'var(--border-default)',
  margin: '0 4px'
};

export default RollingCadenceTimelineBuilder;
