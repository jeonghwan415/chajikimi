"""차량 지킴이 문서(01~06 .docx)를 한글 파일(.hwpx)로 바꾼다.
이 문서들이 쓰는 모양(제목, 굵은 글씨, 글자색, 글머리표, 표·칸 합치기·칸 색, 그림, 머리말)만 옮긴다.
사용: python3 docx2hwpx.py 입력.docx 출력.hwpx
"""
import sys, io, re, warnings
warnings.filterwarnings('ignore')
import docx
from docx.oxml.ns import qn
from hwpx.document import HwpxDocument

FONT = '맑은 고딕'


def col_letter(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


class Conv:
    def __init__(self, src):
        self.src = docx.Document(src)
        self.d = HwpxDocument.new()
        self.d.page.setup(paper_size='A4', orientation='portrait', margin_left_mm=20, margin_right_mm=20,
                          margin_top_mm=20, margin_bottom_mm=20, header_margin_mm=12, footer_margin_mm=12)
        self.runs = {}
        self.paras = {}
        self.fills = {}
        self.line = self.d.styles.ensure_border_fill(border_color='#8A94A3', border_width='0.12 mm')

    # 글자 모양 (굵게, 크기, 색)
    def run_style(self, bold=False, size=10, color=None):
        key = (bold, size, color)
        if key not in self.runs:
            self.runs[key] = self.d.styles.ensure_run(bold=bold, size=size, color=color, font=FONT)
        return self.runs[key]

    def para_style(self, align='LEFT'):
        if align not in self.paras:
            self.paras[align] = self.d.styles.ensure_paragraph_format(alignment=align)
        return self.paras[align]

    def fill(self, color):
        if color not in self.fills:
            self.fills[color] = self.d.styles.ensure_border_fill(border_color='#8A94A3', border_width='0.12 mm', fill_color='#' + color)
        return self.fills[color]

    @staticmethod
    def run_props(r, base=10):
        rp = r._r.rPr
        bold = bool(r.bold)
        size = r.font.size.pt if r.font.size else base
        color = None
        if rp is not None and rp.find(qn('w:color')) is not None:
            v = rp.find(qn('w:color')).get(qn('w:val'))
            if v and v != 'auto':
                color = '#' + v
        return bold, size, color

    def para_kind(self, p):
        st = p.style.name if p.style is not None else ''
        num = p._p.pPr is not None and p._p.pPr.find(qn('w:numPr')) is not None
        jc = p._p.pPr.find(qn('w:jc')) if p._p.pPr is not None else None
        align = 'CENTER' if (jc is not None and jc.get(qn('w:val')) == 'center') else 'LEFT'
        return st, num, align

    def fill_paragraph(self, target_para, p, first=True):
        """p(.docx 문단)의 글자들을 target_para(.hwpx 문단)에 옮긴다."""
        st, num, align = self.para_kind(p)
        base, hbold, hcolor = 10, False, None
        if st.startswith('Heading 1'):
            base, hbold, hcolor = 14, True, '#22406E'
        elif st.startswith('Heading 2'):
            base, hbold, hcolor = 12, True, '#22406E'
        if num:
            target_para.add_run('• ', char_pr_id_ref=self.run_style(False, base, None))
        any_run = False
        for r in p.runs:
            if not r.text:
                continue
            b, s, c = self.run_props(r, base)
            target_para.add_run(r.text, char_pr_id_ref=self.run_style(b or hbold, s, c or hcolor))
            any_run = True
        return any_run

    def add_para(self, p, section_doc):
        st, num, align = self.para_kind(p)
        drawings = p._p.findall('.//' + qn('w:drawing'))
        if drawings:
            for dr in drawings:
                blip = dr.find('.//' + qn('a:blip'))
                ext = dr.find('.//' + qn('wp:extent'))
                rid = blip.get(qn('r:embed'))
                part = self.src.part.related_parts[rid]
                w_mm = int(ext.get('cx')) / 36000.0
                h_mm = int(ext.get('cy')) / 36000.0
                fmt = part.content_type.split('/')[-1].replace('jpeg', 'jpg')
                self.d.add_picture(part.blob, fmt, width_mm=round(w_mm, 1), height_mm=round(h_mm, 1), align='CENTER',
                                   para_pr_id_ref=self.para_style('CENTER'))
            return
        hp = self.d.add_paragraph('', para_pr_id_ref=self.para_style(align), include_run=False)
        if not self.fill_paragraph(hp, p):
            hp.add_run('', char_pr_id_ref=self.run_style())

    def add_table(self, tbl):
        grid = [int(g.get(qn('w:w'))) for g in tbl._tbl.tblGrid.findall(qn('w:gridCol'))]
        rows = tbl._tbl.findall(qn('w:tr'))
        R, C = len(rows), len(grid)
        total_w = int((210 - 40) * 283.465)
        t = self.d.add_table(R, C, border_fill_id_ref=self.line, para_pr_id_ref=self.para_style('LEFT'))
        widths = [int(total_w * g / sum(grid)) for g in grid]
        widths[-1] += total_w - sum(widths)
        try:
            t.set_column_widths(widths)
        except Exception:
            pass
        merges = []
        for ri, tr in enumerate(rows):
            ci = 0
            for tc in tr.findall(qn('w:tc')):
                tcPr = tc.find(qn('w:tcPr'))
                span = 1
                fillc = None
                if tcPr is not None:
                    gs = tcPr.find(qn('w:gridSpan'))
                    if gs is not None:
                        span = int(gs.get(qn('w:val')))
                    shd = tcPr.find(qn('w:shd'))
                    if shd is not None and shd.get(qn('w:fill')) not in (None, 'auto', 'FFFFFF'):
                        fillc = shd.get(qn('w:fill'))
                cell = t.cell(ri, ci)
                paras = [docx.text.paragraph.Paragraph(x, self.src._body) for x in tc.findall(qn("w:p"))]
                hparas = cell.paragraphs
                for k, p in enumerate(paras):
                    st, num, align = self.para_kind(p)
                    if k == 0:
                        hp = hparas[0]
                        for r in list(hp.runs):
                            try:
                                r.remove()
                            except Exception:
                                pass
                        hp.para_pr_id_ref = self.para_style(align)
                    else:
                        hp = cell.add_paragraph('', para_pr_id_ref=self.para_style(align))
                        for r in list(hp.runs):
                            r.remove()
                    if not self.fill_paragraph(hp, p):
                        hp.add_run('', char_pr_id_ref=self.run_style())
                if fillc:
                    t.set_cell_border_fill(ri, ci, self.fill(fillc))
                if span > 1:
                    merges.append('%s%d:%s%d' % (col_letter(ci), ri + 1, col_letter(ci + span - 1), ri + 1))
                ci += span
        for m in merges:
            self.d.merge_table_cells(t, m)
        # 표 다음에 한 줄 띄운다
        self.d.add_paragraph('', char_pr_id_ref=self.run_style(False, 4))

    def convert(self, out):
        body = self.src.element.body
        for el in body.iterchildren():
            if el.tag == qn('w:p'):
                self.add_para(docx.text.paragraph.Paragraph(el, self.src._body), None)
            elif el.tag == qn('w:tbl'):
                self.add_table(docx.table.Table(el, self.src._body))
        # 머리말
        try:
            htxt = ''.join(p.text for p in self.src.sections[0].header.paragraphs).strip()
            if htxt:
                self.d.set_header_text(htxt)
        except Exception:
            pass
        rep = self.d.validate()
        self.d.save_to_path(out)
        return rep


if __name__ == '__main__':
    print(Conv(sys.argv[1]).convert(sys.argv[2]))
