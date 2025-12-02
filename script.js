const DEFAULTS = {
    INITIAL_PASSAGE_ID: 1,
    RESIZE_DEBOUNCE_MS: 150,
};

const DRAWING = {
    PEN_COLOR: '#FF0000',
    PEN_WIDTH: 4,
    ERASER_WIDTH: 40,
};

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

class SlideshowApp {
    constructor(passagesData) {
        this.passages = new Map(passagesData.map(p => [p.passageId, p]));

        this.dom = {
            slideshow: document.getElementById('slideshow-container'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            clickBtn: document.getElementById('click-btn'),
            penBtn: document.getElementById('pen-btn'),
            eraserBtn: document.getElementById('eraser-btn'),
            clearBtn: document.getElementById('clear-btn'),
            passageGroup: document.getElementById('passage-group'),
            categorySelect: document.getElementById('category-select'),
            modal: document.getElementById('imageModal'),
            modalImage: document.getElementById('modalImage'),
            modalCloseBtn: document.querySelector('.close-btn'),
        };

        this.state = {
            currentSlideIndex: 0,
            currentSlides: [],
            currentMode: 'click',
            currentTool: 'pen',
            isDrawing: false,

            // ★ 필기감 개선을 위한 좌표 변수 추가
            lastPos: { x: 0, y: 0 },    // 마우스/터치 위치 (제어점)
            lastEnd: { x: 0, y: 0 },    // 실제 선이 끝난 위치 (시작점)

            // ★ 드로잉 최적화 (렉 방지)를 위한 캐시
            canvasRect: null,
            canvasScale: { x: 1, y: 1 }
        };

        this.debouncedResize = debounce(this.handleResize.bind(this), DEFAULTS.RESIZE_DEBOUNCE_MS);
    }

    init() {
        this.setupCategoryDropdown();
        this.createPassageButtons();
        this.setupGlobalEventListeners();

        const initialPassageId = this.passages.keys().next().value || DEFAULTS.INITIAL_PASSAGE_ID;
        this.loadPassage(initialPassageId);
    }

    // --- Category Logic ---
    setupCategoryDropdown() {
        if (!this.dom.categorySelect) return;

        const categories = new Set();
        this.passages.forEach(p => {
            // 카테고리가 있는 경우만 수집
            if (p.category) categories.add(p.category);
        });

        this.dom.categorySelect.innerHTML = ''; // 기존 옵션 초기화

        // ★ 변경점: '전체 보기' 옵션 추가하는 코드를 삭제했습니다.
        // this.dom.categorySelect.innerHTML = '<option value="all">📂 전체 보기</option>'; (삭제됨)

        // 카테고리들만 추가
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            this.dom.categorySelect.appendChild(option);
        });

        // 이벤트 리스너 연결
        this.dom.categorySelect.addEventListener('change', () => this.createPassageButtons());
    }

    /* script.js - createPassageButtons 함수 교체 */

    createPassageButtons() {
        const selectEl = this.dom.categorySelect;
        this.dom.passageGroup.innerHTML = '';

        // 현재 선택된 카테고리 값 (전체 보기가 없으므로, 무조건 어떤 카테고리가 선택되어 있습니다)
        const currentCategory = selectEl ? selectEl.value : '';

        this.passages.forEach((passage, passageId) => {
            const passageCat = passage.category || '기타';

            // ★ 필터링 로직: 선택된 카테고리와 다르면 버튼 안 만듦
            // (이제 'all'인 경우가 없으므로 단순 비교만 하면 됩니다)
            if (currentCategory && passageCat !== currentCategory) {
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'passage-btn';
            btn.textContent = `${passageId}`; // 숫자만
            btn.addEventListener('click', () => this.loadPassage(passageId));
            this.dom.passageGroup.appendChild(btn);
        });

        // ★ 드롭다운을 버튼들 맨 뒤로 이동시키기
        if (selectEl) {
            selectEl.style.marginLeft = '15px';
            selectEl.style.display = 'inline-block'; // 다시 보이게 하기
            this.dom.passageGroup.appendChild(selectEl);
        }
    }

    // --- Parsing Logic ---
    parseSyntax(text) {
        if (!text) return '';

        // 1. [[단어|뜻|태그]] 처리 (기존과 동일)
        let parsed = text.replace(/\[\[(.*?)\|(.*?)(?:\|(.*?))?\]\]/g, (match, word, tip, type) => {
            const classType = type ? `anno-${type.trim()}` : 'anno-vocab';
            return `<span class="anno ${classType}">${word}<span class="tip">${tip}</span></span>`;
        });

        // 2. {{괄호}} 처리 (수정됨)
        // 기존: 짝을 찾아서 내용을 감싸는 방식 (중첩 불가)
        // 수정: 단순히 {{ 를 [ 로, }} 를 ] 로 각각 변경 (중첩/연속 가능)

        parsed = parsed.replace(/\{\{/g, '<span class="bracket">[</span>');
        parsed = parsed.replace(/\}\}/g, '<span class="bracket">]</span>');

        return parsed;
    }

    loadPassage(passageId) {
        const passageData = this.passages.get(passageId);
        if (!passageData) return;

        this.dom.slideshow.innerHTML = '<div class="slide-counter" id="counter"></div>';

        passageData.slides.forEach(slideData => {
            const slideEl = document.createElement('div');
            slideEl.className = 'slide';
            slideEl.innerHTML = this.getSlideContent(slideData) + '<canvas class="drawing-canvas"></canvas>';
            this.dom.slideshow.appendChild(slideEl);
        });

        this.state.currentSlides = this.dom.slideshow.querySelectorAll(".slide");
        this.setupSlideSpecificEventListeners();
        this.showSlide(1);
    }

    /* script.js - getSlideContent 함수 교체 */

    getSlideContent(slideData) {
        // 1. 일반 지문 (기존과 동일)
        if (slideData.type === 'passage') {
            const parsedHTML = this.parseSyntax(slideData.content);
            return `<p class="passage">${parsedHTML}</p>`;
        }

        // 2. 퀴즈 (수정됨: 정답 체크 기능 제거, 구문 분석 기능 추가)
        if (slideData.type === 'quiz') {
            // 질문에도 구문 분석 적용 (혹시 질문에 모르는 단어가 있을 수 있으니)
            const parsedQuestion = this.parseSyntax(slideData.question);

            // 보기(options) 하나하나를 '지문'처럼 변환
            const optionsHTML = slideData.options.map((opt, i) => {
                const parsedOpt = this.parseSyntax(opt);
                // data-answer 같은 정답 관련 태그는 다 빼버리고, 순수하게 번호와 내용만 표시
                return `<li><span class="opt-num">${i + 1}.</span> ${parsedOpt}</li>`;
            }).join('');

            const optionsClass = slideData.summary ? 'quiz-options-summary-layout' : (slideData.isGrid ? 'quiz-options-grid' : '');

            return `
                <div class="quiz-container ${slideData.isLast ? 'last-quiz' : ''}">
                    ${slideData.summary ? `<p class="quiz-summary">${this.parseSyntax(slideData.summary)}</p>` : ''}
                    <p class="quiz-question">${parsedQuestion}</p>
                    <ul class="quiz-options ${optionsClass}">
                        ${optionsHTML}
                    </ul>
                </div>`;
        }
        return '';
    }

    showSlide(slideNumber) {
        this.state.currentSlideIndex = slideNumber;
        this.state.currentSlides.forEach((slide, index) => {
            slide.style.display = (index === this.state.currentSlideIndex - 1) ? "flex" : "none";
        });

        const counter = this.dom.slideshow.querySelector('#counter');
        if (counter) counter.innerText = `${this.state.currentSlideIndex} / ${this.state.currentSlides.length}`;

        this.dom.prevBtn.disabled = (this.state.currentSlideIndex === 1);
        this.dom.nextBtn.disabled = (this.state.currentSlideIndex === this.state.currentSlides.length);

        this.resizeActiveCanvas();
        this.setMode(this.state.currentMode);
    }

    setMode(mode) {
        this.state.currentMode = mode;
        const activeCanvas = this.getActiveCanvas();
        if (activeCanvas) {
            activeCanvas.style.pointerEvents = (mode === 'draw') ? 'auto' : 'none';
        }
        this.updateToolButtons();
    }

    updateToolButtons() {
        this.dom.clickBtn.classList.toggle('active', this.state.currentMode === 'click');
        this.dom.penBtn.classList.toggle('active', this.state.currentMode === 'draw' && this.state.currentTool === 'pen');
        this.dom.eraserBtn.classList.toggle('active', this.state.currentMode === 'draw' && this.state.currentTool === 'eraser');
    }

    setupGlobalEventListeners() {
        this.dom.prevBtn.addEventListener('click', () => {
            if (this.state.currentSlideIndex > 1) this.showSlide(this.state.currentSlideIndex - 1)
        });
        this.dom.nextBtn.addEventListener('click', () => {
            if (this.state.currentSlideIndex < this.state.currentSlides.length) this.showSlide(this.state.currentSlideIndex + 1)
        });

        this.dom.clickBtn.addEventListener('click', () => this.setMode('click'));
        this.dom.penBtn.addEventListener('click', () => { this.state.currentTool = 'pen'; this.setMode('draw'); });
        this.dom.eraserBtn.addEventListener('click', () => { this.state.currentTool = 'eraser'; this.setMode('draw'); });
        this.dom.clearBtn.addEventListener('click', () => this.clearActiveCanvas());

        this.dom.modalCloseBtn.addEventListener('click', () => this.hideModal());
        this.dom.modal.addEventListener('click', (e) => {
            if (e.target === this.dom.modal) this.hideModal();
        });

        window.addEventListener('resize', this.debouncedResize);

        // ★ 키보드 단축키 설정 (수업의 흐름을 끊지 않는 핵심 기능)
        document.addEventListener('keydown', (e) => {
            // 입력창 같은 곳에 포커스가 있을 때는 단축키 작동 중지 (오작동 방지)
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                // 1. 슬라이드 이동 (방향키, 스페이스바)
                case 'ArrowRight':
                case ' ': // 스페이스바
                    e.preventDefault(); // 스크롤 방지
                    if (this.state.currentSlideIndex < this.state.currentSlides.length) {
                        this.showSlide(this.state.currentSlideIndex + 1);
                    }
                    break;

                case 'ArrowLeft':
                    e.preventDefault();
                    if (this.state.currentSlideIndex > 1) {
                        this.showSlide(this.state.currentSlideIndex - 1);
                    }
                    break;

                // 2. 도구 변경 (숫자키 1, 2, 3)
                case '1':
                    this.setMode('click'); // 1번: 클릭(손가락)
                    break;
                case '2':
                    this.state.currentTool = 'pen';
                    this.setMode('draw');  // 2번: 빨간펜
                    break;
                case '3':
                    this.state.currentTool = 'eraser';
                    this.setMode('draw');  // 3번: 지우개
                    break;

                // 3. 필기 싹 지우기 (C키 - Clear)
                case 'c':
                case 'C':
                case 'ㅊ': // 한글 키보드 상태일 때도 작동하게
                    this.clearActiveCanvas();
                    break;
                // ★ 3. 전체 화면 (F키 - Fullscreen)
                case 'f':
                case 'F':
                case 'ㄹ': // 한글 키보드 대응
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen(); // 전체화면 진입
                    } else {
                        if (document.exitFullscreen) {
                            document.exitFullscreen(); // 전체화면 해제
                        }
                    }
                    break;
            }
        });
    }

    setupSlideSpecificEventListeners() {
        this.dom.slideshow.querySelectorAll('.drawing-canvas').forEach(canvas => {
            canvas.addEventListener('mousedown', this.startDrawing.bind(this));
            canvas.addEventListener('mousemove', this.draw.bind(this));
            canvas.addEventListener('mouseup', this.stopDrawing.bind(this));
            canvas.addEventListener('mouseout', this.stopDrawing.bind(this));
            canvas.addEventListener('touchstart', this.startDrawing.bind(this), { passive: false });
            canvas.addEventListener('touchmove', this.draw.bind(this), { passive: false });
            canvas.addEventListener('touchend', this.stopDrawing.bind(this));
        });

        this.dom.slideshow.querySelectorAll('.anno').forEach(anno => {
            anno.setAttribute('tabindex', '0');
            anno.addEventListener('click', this.handleAnnoClick.bind(this));
            anno.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.handleAnnoClick(e);
                }
            });
            if (anno.dataset.image) {
                anno.addEventListener('contextmenu', this.showImageModal.bind(this));
            }
        });
    }

    handleResize() {
        this.resizeActiveCanvas();
    }

    handleAnnoClick(e) {
        if (this.state.currentMode !== 'click') return;
        e.stopPropagation();
        const tip = e.currentTarget.querySelector('.tip');
        if (!tip) return;

        // 이미 켜져 있으면 끄기
        if (tip.classList.contains('visible')) {
            tip.classList.remove('visible');
            // 스타일 초기화 (다음에 켜질 때 꼬임 방지)
            tip.style.left = '';
            tip.style.removeProperty('--arrow-x');
            return;
        }

        // 1. 일단 툴팁을 초기화하고 화면에 그려서 사이즈를 잴 준비를 합니다.
        tip.classList.remove('down');
        tip.style.visibility = 'hidden';
        tip.style.left = ''; // 위치 초기화
        tip.style.removeProperty('--arrow-x'); // 화살표 초기화
        tip.classList.add('visible');

        // 2. 위치 계산을 위한 좌표값 가져오기
        const tipRect = tip.getBoundingClientRect();
        const containerRect = this.dom.slideshow.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        // ---------------------------------------------
        // [수직 보정] 위쪽으로 잘리거나 다른 툴팁과 겹치면 아래로 내리기
        // ---------------------------------------------
        const isOverlapping = Array.from(this.dom.slideshow.querySelectorAll('.tip.visible')).some(visibleTip => {
            if (visibleTip === tip) return false;
            const visibleTipRect = visibleTip.getBoundingClientRect();
            return tipRect.left < visibleTipRect.right &&
                tipRect.right > visibleTipRect.left &&
                tipRect.top < visibleTipRect.bottom &&
                tipRect.bottom > visibleTipRect.top;
        });

        const isClippedTop = tipRect.top < containerRect.top;

        if (isOverlapping || isClippedTop) {
            tip.classList.add('down');
        }

        // ---------------------------------------------
        // [★ 수평 보정 추가] 오른쪽 화면 밖으로 나가는지 체크
        // ---------------------------------------------
        // 팁을 다시 측정 (down 클래스가 붙었을 수도 있으니)
        const finalRect = tip.getBoundingClientRect();

        // 화면 오른쪽 끝에서 20px 정도 여유를 둡니다.
        const rightEdge = viewportWidth - 20;

        if (finalRect.right > rightEdge) {
            // 1. 얼마나 튀어 나갔는지 계산 (튀어 나간 만큼 + 여유분)
            const overflowX = finalRect.right - rightEdge;

            // 2. 툴팁 몸통을 왼쪽으로 당김
            // (기본이 left:0이므로 음수값을 주면 왼쪽으로 이동)
            tip.style.left = `-${overflowX}px`;

            // 3. 몸통이 이동한 만큼 화살표는 반대(오른쪽)로 밀어줘서
            // 화살표가 여전히 원래 단어를 가리키게 함
            // (기본값 15px + 이동한 거리)
            tip.style.setProperty('--arrow-x', `${15 + overflowX}px`);
        }

        // 3. 최종적으로 보이게 설정
        tip.classList.remove('visible');
        tip.style.visibility = '';
        tip.classList.add('visible');
    }

    handleQuizClick(e) {
        if (Tone.context.state !== 'running') Tone.start();
        const option = e.currentTarget;
        const parentUl = option.parentElement;
        const answer = parentUl.dataset.answer;
        const isCorrect = option.dataset.option === answer;

        if (isCorrect) {
            option.classList.add('correct');
            option.classList.remove('incorrect');
            this.sounds.correct.triggerAttackRelease("C5", "8n");
        } else {
            option.classList.add('incorrect');
            option.classList.remove('correct');
            this.sounds.incorrect.triggerAttackRelease("A2", "8n");
        }
    }

    showImageModal(e) {
        e.preventDefault();
        if (this.state.currentMode !== 'click') return;
        const imageName = e.currentTarget.dataset.image;
        this.dom.modalImage.src = imageName;
        this.dom.modalImage.alt = imageName;
        this.dom.modal.style.display = 'flex';
    }

    hideModal() {
        this.dom.modal.style.display = 'none';
        this.dom.modalImage.src = '';
        this.dom.modalImage.alt = '';
    }

    getActiveCanvas() {
        if (this.state.currentSlides.length === 0) return null;
        return this.state.currentSlides[this.state.currentSlideIndex - 1]?.querySelector('.drawing-canvas');
    }

    clearActiveCanvas() {
        const canvas = this.getActiveCanvas();
        if (canvas) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    resizeActiveCanvas() {
        const canvas = this.getActiveCanvas();
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { width, height } = canvas.getBoundingClientRect();
        canvas.width = width;
        canvas.height = height;
        ctx.putImageData(imageData, 0, 0);
    }

    // ★ 개선된 getPos: 계산된 rect를 캐시하여 렉을 줄임
    getPos(evt) {
        // startDrawing에서 계산된 rect가 없으면 비상용으로 즉시 계산
        if (!this.state.canvasRect) {
            const canvas = evt.target;
            this.state.canvasRect = canvas.getBoundingClientRect();
            this.state.canvasScale = {
                x: canvas.width / this.state.canvasRect.width,
                y: canvas.height / this.state.canvasRect.height
            };
        }

        const clientX = evt.clientX || evt.touches[0].clientX;
        const clientY = evt.clientY || evt.touches[0].clientY;

        return {
            x: (clientX - this.state.canvasRect.left) * this.state.canvasScale.x,
            y: (clientY - this.state.canvasRect.top) * this.state.canvasScale.y
        };
    }

    startDrawing(e) {
        if (this.state.currentMode !== 'draw') return;
        e.preventDefault();

        const canvas = e.target;

        // ★ 필기 최적화 1: 그리기 시작할 때 한 번만 위치 계산 (렉 방지 핵심)
        this.state.canvasRect = canvas.getBoundingClientRect();
        this.state.canvasScale = {
            x: canvas.width / this.state.canvasRect.width,
            y: canvas.height / this.state.canvasRect.height
        };

        const pos = this.getPos(e);
        this.state.isDrawing = true;

        // ★ 필기감 개선 1: 부드러운 곡선 연결을 위한 좌표 초기화
        this.state.lastPos = pos; // 마우스/터치 포인트 (제어점)
        this.state.lastEnd = pos; // 획이 실제로 끝난 점 (시작점)

        // 점 하나만 찍었을 때를 대비해 점 그리기
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.lineWidth = (this.state.currentTool === 'pen') ? DRAWING.PEN_WIDTH : DRAWING.ERASER_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (this.state.currentTool === 'pen') {
            ctx.strokeStyle = DRAWING.PEN_COLOR;
            ctx.globalCompositeOperation = 'source-over';
        } else {
            ctx.globalCompositeOperation = 'destination-out';
        }
        ctx.stroke();
    }

    stopDrawing() {
        this.state.isDrawing = false;
        this.state.canvasRect = null; // 캐시 초기화
    }

    draw(e) {
        if (!this.state.isDrawing) return;
        e.preventDefault();

        const canvas = e.target;
        const ctx = canvas.getContext('2d');
        const currentPos = this.getPos(e); // 최적화된 함수 사용

        // ★ 필기감 개선 2: Quadratic Curve (곡선 보간법) 적용
        if (this.state.currentTool === 'pen') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = DRAWING.PEN_COLOR;
            ctx.lineWidth = DRAWING.PEN_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // (1) 현재 점과 이전 제어점의 '중간 지점'을 구합니다.
            const midPoint = {
                x: (this.state.lastPos.x + currentPos.x) / 2,
                y: (this.state.lastPos.y + currentPos.y) / 2
            };

            ctx.beginPath();
            // (2) '이전 획이 끝난 곳'에서 시작해서
            ctx.moveTo(this.state.lastEnd.x, this.state.lastEnd.y);
            // (3) '이전 마우스 위치'를 당기는 힘(제어점)으로 삼아 '중간 지점'까지 부드럽게 잇습니다.
            ctx.quadraticCurveTo(this.state.lastPos.x, this.state.lastPos.y, midPoint.x, midPoint.y);
            ctx.stroke();

            // (4) 다음 획을 위해 변수 업데이트
            this.state.lastPos = currentPos; // 마우스 위치 갱신
            this.state.lastEnd = midPoint;   // 획의 끝점 갱신

        } else {
            // 지우개는 반응 속도가 중요하므로 기존 방식(직선 연결) 유지
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = DRAWING.ERASER_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.moveTo(this.state.lastPos.x, this.state.lastPos.y);
            ctx.lineTo(currentPos.x, currentPos.y);
            ctx.stroke();

            this.state.lastPos = currentPos;
            this.state.lastEnd = currentPos;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // ★ 변경: allPassagesData 대신 window.MASTER_DATA를 사용합니다.
    if (typeof window.MASTER_DATA !== 'undefined' && window.MASTER_DATA.length > 0) {

        // 바구니에 담긴 데이터를 앱에 넣어줍니다.
        const app = new SlideshowApp(window.MASTER_DATA);
        app.init();
    } else {
        console.error('Error: 데이터가 없습니다. data 폴더의 파일들이 잘 연결되었는지 확인하세요.');
    }
});