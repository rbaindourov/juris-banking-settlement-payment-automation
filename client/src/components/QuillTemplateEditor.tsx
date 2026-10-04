import React, { useState, useRef } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Link as LinkIcon,
  Eye,
  Tag,
  Undo,
  Redo,
  Globe
} from 'lucide-react';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { caseApi } from '../services/api';

interface QuillTemplateEditorProps {
  caseId: string;
  caseName: string;
  initialHtml?: string;
  onChange?: (html: string) => void;
  label?: string;
  supportedLanguages?: string[];
  currentLanguage?: string;
}

export const MERGE_TAGS = [
  { tag: '{{claimant_first_name}}', label: 'Claimant First Name', sample: 'Jonathan' },
  { tag: '{{claimant_last_name}}', label: 'Claimant Last Name', sample: 'Doe' },
  { tag: '{{settlement_amount}}', label: 'Settlement Amount ($)', sample: '$450.00' },
  { tag: '{{case_name}}', label: 'Case Name', sample: 'In re Apex Privacy Litigation' },
  { tag: '{{selection_deadline}}', label: 'Selection Deadline', sample: 'November 30, 2026' },
  {
    tag: '{{payment_selection_link}}',
    label: 'Payment Selection Magic Link',
    sample: 'https://portal.juris-banking.com/claim/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  }
];

export const QuillTemplateEditor: React.FC<QuillTemplateEditorProps> = ({
  caseId,
  caseName,
  initialHtml = '',
  onChange,
  label = 'Email Template HTML',
  supportedLanguages = ['en', 'es', 'zh', 'vi'],
  currentLanguage = 'en'
}) => {
  const [content, setContent] = useState<string>(initialHtml);
  const [selectedLang, setSelectedLang] = useState<string>(currentLanguage);
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const handleInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      setContent(html);
      onChange?.(html);
    }
  };

  const executeCommand = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    handleInput();
  };

  const insertMergeTag = (tag: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('insertText', false, tag);
      handleInput();
    }
  };

  const handleOpenPreview = async () => {
    setIsLoadingPreview(true);
    try {
      const res = await caseApi.previewTemplate(caseId, {
        template: content,
        language: selectedLang
      });
      setPreviewHtml(res.renderedHtml);
      setPreviewOpen(true);
    } catch {
      // Fallback local merge tag resolution
      let fallbackHtml = content;
      MERGE_TAGS.forEach(({ tag, sample }) => {
        fallbackHtml = fallbackHtml.split(tag).join(sample);
      });
      setPreviewHtml(fallbackHtml);
      setPreviewOpen(true);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header with Title and Language Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <label style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
            {label}
          </label>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
            Supports dynamic settlement merge tags, rich formatting, and multi-lingual localization
          </span>
        </div>

        {/* Locale tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'var(--bg-card-subtle)', padding: '3px', borderRadius: 'var(--radius-md)' }}>
          <Globe size={14} color="var(--text-muted)" style={{ margin: '0 4px' }} aria-hidden="true" />
          {supportedLanguages.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setSelectedLang(lang)}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                backgroundColor: selectedLang === lang ? '#ffffff' : 'transparent',
                color: selectedLang === lang ? 'var(--color-primary)' : 'var(--text-muted)',
                boxShadow: selectedLang === lang ? 'var(--shadow-xs)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Editor Container */}
      <div
        className="fintech-card"
        style={{
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          backgroundColor: '#ffffff'
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 14px',
            backgroundColor: 'var(--bg-card-subtle)',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          {/* Text formatting */}
          <button
            type="button"
            title="Bold"
            aria-label="Bold text"
            onClick={() => executeCommand('bold')}
            style={toolbarButtonStyle}
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            title="Italic"
            aria-label="Italic text"
            onClick={() => executeCommand('italic')}
            style={toolbarButtonStyle}
          >
            <Italic size={16} />
          </button>
          <button
            type="button"
            title="Underline"
            aria-label="Underline text"
            onClick={() => executeCommand('underline')}
            style={toolbarButtonStyle}
          >
            <Underline size={16} />
          </button>

          <span style={dividerStyle} />

          {/* Headings */}
          <button
            type="button"
            title="Heading 1"
            aria-label="Heading 1"
            onClick={() => executeCommand('formatBlock', '<h1>')}
            style={toolbarButtonStyle}
          >
            <Heading1 size={16} />
          </button>
          <button
            type="button"
            title="Heading 2"
            aria-label="Heading 2"
            onClick={() => executeCommand('formatBlock', '<h2>')}
            style={toolbarButtonStyle}
          >
            <Heading2 size={16} />
          </button>

          <span style={dividerStyle} />

          {/* Lists */}
          <button
            type="button"
            title="Bullet List"
            aria-label="Bullet list"
            onClick={() => executeCommand('insertUnorderedList')}
            style={toolbarButtonStyle}
          >
            <List size={16} />
          </button>
          <button
            type="button"
            title="Numbered List"
            aria-label="Numbered list"
            onClick={() => executeCommand('insertOrderedList')}
            style={toolbarButtonStyle}
          >
            <ListOrdered size={16} />
          </button>

          <span style={dividerStyle} />

          {/* Link */}
          <button
            type="button"
            title="Insert Link"
            aria-label="Insert link"
            onClick={() => {
              const url = prompt('Enter URL (or merge tag):', '{{payment_selection_link}}');
              if (url) executeCommand('createLink', url);
            }}
            style={toolbarButtonStyle}
          >
            <LinkIcon size={16} />
          </button>

          {/* Undo / Redo */}
          <button
            type="button"
            title="Undo"
            aria-label="Undo edit"
            onClick={() => executeCommand('undo')}
            style={toolbarButtonStyle}
          >
            <Undo size={16} />
          </button>
          <button
            type="button"
            title="Redo"
            aria-label="Redo edit"
            onClick={() => executeCommand('redo')}
            style={toolbarButtonStyle}
          >
            <Redo size={16} />
          </button>

          {/* Live Preview Button */}
          <div style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={handleOpenPreview}
              disabled={isLoadingPreview}
              aria-label="Preview Live Template"
              className="btn-primary"
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <Eye size={15} aria-hidden="true" />
              <span>{isLoadingPreview ? 'Rendering...' : 'Preview Live'}</span>
            </button>
          </div>
        </div>

        {/* Dynamic Merge Tag Pill Strip */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Tag size={13} color="var(--color-indigo)" aria-hidden="true" />
            Merge Tags:
          </span>
          {MERGE_TAGS.map(({ tag, label: tagLabel }) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertMergeTag(tag)}
              title={`Click to insert ${tagLabel}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 9px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--bg-active)',
                border: '1px solid #bfdbfe',
                color: 'var(--color-indigo)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>{tag}</span>
            </button>
          ))}
        </div>

        {/* Content Editable Area */}
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          dangerouslySetInnerHTML={{ __html: initialHtml }}
          aria-label="Template email body editor"
          style={{
            minHeight: '260px',
            maxHeight: '480px',
            overflowY: 'auto',
            padding: '20px',
            outline: 'none',
            fontSize: '14px',
            lineHeight: 1.6,
            color: 'var(--text-primary)'
          }}
        />
      </div>

      {/* Live Preview Modal */}
      <TemplatePreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        renderedHtml={previewHtml}
        caseName={caseName}
        supportedLanguages={supportedLanguages}
        currentLanguage={selectedLang}
        onLanguageChange={(l) => setSelectedLang(l)}
      />
    </div>
  );
};

const toolbarButtonStyle: React.CSSProperties = {
  width: '30px',
  height: '30px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: '#ffffff',
  border: '1px solid var(--border-default)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'all 0.15s ease'
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '20px',
  backgroundColor: 'var(--border-default)',
  margin: '0 4px'
};
