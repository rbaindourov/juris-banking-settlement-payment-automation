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
  Redo
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
  supportedLanguages = ['en'],
  currentLanguage = 'en'
}) => {
  const [content, setContent] = useState<string>(initialHtml);
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
    // Focus editor and insert HTML span containing merge tag
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
        language: currentLanguage
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
            {label}
          </label>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Supports dynamic merge tags & safe styling
          </span>
        </div>
      )}

      {/* Editor Container */}
      <div
        style={{
          border: '1px solid #cbd5e1',
          borderRadius: '8px',
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
            padding: '8px 12px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0'
          }}
        >
          {/* Text formatting */}
          <button
            type="button"
            title="Bold"
            onClick={() => executeCommand('bold')}
            style={toolbarButtonStyle}
          >
            <Bold size={16} />
          </button>
          <button
            type="button"
            title="Italic"
            onClick={() => executeCommand('italic')}
            style={toolbarButtonStyle}
          >
            <Italic size={16} />
          </button>
          <button
            type="button"
            title="Underline"
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
            onClick={() => executeCommand('formatBlock', '<h1>')}
            style={toolbarButtonStyle}
          >
            <Heading1 size={16} />
          </button>
          <button
            type="button"
            title="Heading 2"
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
            onClick={() => executeCommand('insertUnorderedList')}
            style={toolbarButtonStyle}
          >
            <List size={16} />
          </button>
          <button
            type="button"
            title="Numbered List"
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
            onClick={() => executeCommand('undo')}
            style={toolbarButtonStyle}
          >
            <Undo size={16} />
          </button>
          <button
            type="button"
            title="Redo"
            onClick={() => executeCommand('redo')}
            style={toolbarButtonStyle}
          >
            <Redo size={16} />
          </button>

          <span style={dividerStyle} />

          {/* Dynamic Merge Tag Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Tag size={16} color="#0284c7" />
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  insertMergeTag(e.target.value);
                  e.target.value = '';
                }
              }}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                backgroundColor: '#f0f9ff',
                color: '#0369a1',
                fontWeight: 500
              }}
            >
              <option value="" disabled>
                Insert Merge Tag...
              </option>
              {MERGE_TAGS.map(({ tag, label: tagLabel }) => (
                <option key={tag} value={tag}>
                  {tagLabel} ({tag})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={handleOpenPreview}
              disabled={isLoadingPreview}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                backgroundColor: '#1e3a8a',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500
              }}
            >
              <Eye size={15} />
              {isLoadingPreview ? 'Rendering...' : 'Live Preview'}
            </button>
          </div>
        </div>

        {/* Content Editable Area */}
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          dangerouslySetInnerHTML={{ __html: initialHtml }}
          style={{
            minHeight: '260px',
            maxHeight: '480px',
            overflowY: 'auto',
            padding: '16px',
            outline: 'none',
            fontSize: '14px',
            lineHeight: 1.6,
            color: '#1e293b'
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
        currentLanguage={currentLanguage}
      />
    </div>
  );
};

const toolbarButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  borderRadius: '6px',
  border: '1px solid transparent',
  backgroundColor: 'transparent',
  color: '#475569',
  padding: '4px'
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  height: '20px',
  backgroundColor: '#cbd5e1',
  margin: '0 4px'
};
