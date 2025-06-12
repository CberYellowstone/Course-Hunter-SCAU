// ==UserScript==
// @name         华南农业大学选课助手 (v8.1 完整修复版)
// @namespace    http://tampermonkey.net/
// @version      8.1
// @description  【专业完整版】修复v8.0代码不完整的问题。功能：1. 自动解锁. 2. 增强捕获. 3. 批量定时发送. 4. 列表显示教师. 5. 窗口可调整大小. 6. 智能结果显示. 7. 抢课自动重试机制.
// @author       Gemini & your-name
// @match        https://jwxt.scau.edu.cn/Njw2017/student/student-choice-center/*
// @match        https://jwxt.scau.edu.cn/resService/jwxtpt/v1/xsd/stuCourseCenterController/*
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const SELECT_COURSE_URL_PATTERN = '/v1/xsd/stuCourseCenterController/saveStuXk';
    // --- 配置结束 ---

    let capturedRequests = {};
    let listContainer = null;
    let overallStatusDiv = null;

    /*****************************************************************
     * 功能一：无差别解锁按钮
     *****************************************************************/
    function unlockAllCourseButtons() {
        const courseRows = document.querySelectorAll('tr.el-table__row');
        courseRows.forEach(row => {
            const selectButton = row.querySelector('button');
            if (selectButton && (selectButton.disabled || selectButton.classList.contains('is-disabled'))) {
                selectButton.removeAttribute('disabled');
                selectButton.classList.remove('is-disabled');
            }
        });
    }

    /*****************************************************************
     * 功能二：捕获并定时发送选课请求
     *****************************************************************/
    function processAndStoreRequest(url, method, body, headers) {
        if (typeof url === 'string' && url.includes(SELECT_COURSE_URL_PATTERN)) {
            try {
                const requestData = JSON.parse(body);
                const courseName = requestData.kcmc_name;
                const teacherName = requestData.skls_name;

                if (!courseName) {
                    console.error("【选课助手】无法从请求体中解析出课程名称(kcmc_name)。", body);
                    return;
                }

                capturedRequests[courseName] = {
                    url: url,
                    method: method.toUpperCase(),
                    body: body,
                    headers: headers,
                    teacherName: teacherName
                };
                renderCapturedList();
            } catch (e) {
                console.error("【选课助手】解析请求体JSON失败:", e);
            }
        }
    }

    function interceptNetworkRequests() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.open = function(method, url) { this._method = method; this._url = url; this._headers = {}; originalOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.setRequestHeader = function(h, v) { this._headers[h.toLowerCase()] = v; originalSetRequestHeader.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function(body) {
            if (this._url) {
                if (!this._headers['content-type'] && body && typeof body === 'string' && body.startsWith('{')) { this._headers['content-type'] = 'application/json;charset=UTF-8'; }
                processAndStoreRequest(this._url, this._method, body, this._headers);
            }
            originalSend.apply(this, arguments);
        };
        const originalFetch = window.fetch;
        window.fetch = async function(input, init = {}) {
            const url = (typeof input === 'string') ? input : input.url;
            const method = init.method || (input.method || 'GET');
            const body = init.body || (input.body || null);
            const headers = {};
            if (init.headers) {
                if (init.headers instanceof Headers) { init.headers.forEach((v, k) => headers[k.toLowerCase()] = v); }
                else { for (const k in init.headers) { headers[k.toLowerCase()] = init.headers[k]; } }
            }
            if (!headers['content-type'] && body && typeof body === 'string' && body.startsWith('{')) { headers['content-type'] = 'application/json;charset=UTF-8'; }
            processAndStoreRequest(url, method, body, headers);
            return originalFetch.apply(this, arguments);
        };
        console.log('【选课助手】网络请求拦截器已启动 (XHR & Fetch)。');
    }

    function sendAllCapturedRequests() {
        const courseCount = Object.keys(capturedRequests).length;
        updateOverallStatus(`⏰ 时间到！正在发送 ${courseCount} 个选课请求...`);
        for (const courseName in capturedRequests) {
            sendSingleRequest(courseName, capturedRequests[courseName], 0);
        }
    }

    function sendSingleRequest(courseName, request, retryCount) {
        const itemStatusSpan = document.querySelector(`#captured-item-status-${courseName.replace(/[^a-zA-Z0-9]/g, '-')}`);
        const retryEnabled = document.getElementById('retry-enabled-checkbox').checked;
        const maxRetries = parseInt(document.getElementById('retry-attempts-input').value) || 3;
        const retryDelay = parseInt(document.getElementById('retry-delay-input').value) || 50;

        if (itemStatusSpan) {
            itemStatusSpan.textContent = retryCount > 0 ? `重试(${retryCount})...` : '发送中...';
            itemStatusSpan.style.color = '#ff8c00';
        }

        GM_xmlhttpRequest({
            method: request.method,
            url: request.url,
            headers: request.headers,
            data: request.body,
            timeout: 20000,
            onload: function(response) {
                try {
                    const resData = JSON.parse(response.responseText);
                    const errorMessage = resData.errorMessage || resData.errorCode || "未知错误";
                    if (retryEnabled && (errorMessage.includes('选课未开始') || errorMessage.includes('请稍候')) && retryCount < maxRetries) {
                        if (itemStatusSpan) { itemStatusSpan.textContent = `等待(${retryDelay}ms)`; }
                        setTimeout(() => sendSingleRequest(courseName, request, retryCount + 1), retryDelay);
                        return;
                    }
                    if (resData.data === null && resData.errorMessage) {
                        if (itemStatusSpan) { itemStatusSpan.textContent = `❌ ${errorMessage}`; itemStatusSpan.style.color = 'red'; }
                    } else if (resData.errorMessage === null && resData.errorCode === null) {
                         if (itemStatusSpan) { itemStatusSpan.textContent = `✅ 选课成功！`; itemStatusSpan.style.color = 'green'; }
                    }
                    else {
                        if (itemStatusSpan) { itemStatusSpan.textContent = `🤔 未知: ${response.responseText.slice(0, 100)}`; itemStatusSpan.style.color = 'blue'; }
                    }
                } catch (e) {
                    if (itemStatusSpan) { itemStatusSpan.textContent = `✅ 响应非JSON: ${response.responseText.slice(0, 50)}`; itemStatusSpan.style.color = 'green';}
                }
            },
            onerror: function(response) {
                if (itemStatusSpan) { itemStatusSpan.textContent = `❌ 请求错误: ${response.statusText}`; itemStatusSpan.style.color = 'red'; }
            },
            ontimeout: function() {
                if (itemStatusSpan) { itemStatusSpan.textContent = `❌ 请求超时`; itemStatusSpan.style.color = 'red'; }
            }
        });
    }

    /*****************************************************************
     * UI 和主流程部分
     *****************************************************************/

    function makePanelResizable(panel) {
        const handle = document.createElement('div');
        handle.style.cssText = `position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; z-index: 1;`;
        panel.appendChild(handle);
        let isResizing = false;
        handle.addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX - panel.offsetLeft + 6;
            const newHeight = e.clientY - panel.offsetTop + 6;
            panel.style.width = `${Math.max(360, newWidth)}px`;
            panel.style.height = `${Math.max(300, newHeight)}px`;
        });
        document.addEventListener('mouseup', () => { isResizing = false; });
    }

    function makePanelDraggable(panel, handle) {
        let isDragging = false;
        let offset = { x: 0, y: 0 };
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.id === 'auto-detect-btn' || e.target.id === 'arm-grabber-btn') return;
            isDragging = true;
            offset.x = e.clientX - panel.offsetLeft;
            offset.y = e.clientY - panel.offsetTop;
            handle.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newX = e.clientX - offset.x;
            let newY = e.clientY - offset.y;
            const boundaryX = window.innerWidth - panel.offsetWidth;
            const boundaryY = window.innerHeight - panel.offsetHeight;
            newX = Math.max(0, Math.min(newX, boundaryX));
            newY = Math.max(0, Math.min(newY, boundaryY));
            panel.style.left = `${newX}px`;
            panel.style.top = `${newY}px`;
        });
        document.addEventListener('mouseup', () => {
            isDragging = false;
            handle.style.cursor = 'grab';
            document.body.style.userSelect = '';
        });
    }

    function autoDetectAndFillTime() {
        const pageText = document.body.innerText;
        const regex = /选课时间\s*:\s*(\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}))/;
        const match = pageText.match(regex);
        if (match && match[1]) {
            const dateTimeString = match[1];
            const timePart = match[2];
            const [hours, minutes] = timePart.split(':');
            document.getElementById('grab-time-h').value = hours;
            document.getElementById('grab-time-m').value = minutes;
            document.getElementById('grab-time-s').value = '00';
            document.getElementById('grab-time-ms').value = '500';
            updateOverallStatus(`✅ 已自动识别时间: ${dateTimeString}。已填入并设置默认延迟。`);
        } else {
            updateOverallStatus('❌ 未在页面上找到“选课时间 :<y_bin_46>-MM-dd HH:mm”格式的文本。', true);
        }
    }

    function renderCapturedList() {
        if (!listContainer) return;
        listContainer.innerHTML = '';
        const courseNames = Object.keys(capturedRequests);
        if (courseNames.length === 0) {
            listContainer.innerHTML = '<p style="color: #888; text-align: center; margin: 10px 0;">等待捕获课程...</p>';
            return;
        }
        updateOverallStatus(`${courseNames.length} 门课程已捕获，等待启动。`);
        courseNames.forEach(courseName => {
            const requestData = capturedRequests[courseName];
            const safeId = courseName.replace(/[^a-zA-Z0-9]/g, '-');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'captured-item';
            itemDiv.innerHTML = `
                <div class="course-info">
                    <span class="course-name" title="${courseName}">${courseName}</span>
                    <span class="teacher-name" title="${requestData.teacherName}">${requestData.teacherName || ''}</span>
                </div>
                <span class="course-status" id="captured-item-status-${safeId}">待命</span>
                <button class="delete-btn" data-course-name="${courseName}"></button>
            `;
            listContainer.appendChild(itemDiv);
        });
        listContainer.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const nameToDelete = e.target.dataset.courseName;
                delete capturedRequests[nameToDelete];
                renderCapturedList();
            });
        });
    }

    function updateOverallStatus(message, isError = false) {
        if (overallStatusDiv) {
            overallStatusDiv.innerHTML = message;
            overallStatusDiv.style.color = isError ? '#dc3545' : '#333';
        }
    }

    function createControlPanel() {
        if (document.getElementById('gemini-grabber-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'gemini-grabber-panel';
        panel.style.cssText = `
            position: fixed; top: 80px; left: calc(100% - 380px); z-index: 9999;
            background-color: white; border: 1px solid #ccc; border-radius: 8px;
            padding: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: sans-serif;
            width: 360px; min-width: 360px; height: 420px; min-height: 300px; display: flex; flex-direction: column;
        `;
        panel.innerHTML = `
            <style>
                .time-input-group, .retry-settings-group { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
                .time-input-group label, .retry-settings-group label { font-size: 14px; margin-right: 5px; flex-shrink: 0; }
                .time-input-group input[type="number"], .retry-settings-group input[type="number"] { width: 55px; text-align: center; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; padding: 4px 0; }
                #auto-detect-btn { width: 100%; padding: 6px; margin-bottom: 10px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;}
                #captured-list-container { border: 1px solid #ddd; border-radius: 4px; margin-top: 10px; flex-grow: 1; overflow-y: auto; }
                .captured-item { display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid #eee; }
                .captured-item:last-child { border-bottom: none; }
                .course-info { flex-grow: 1; overflow: hidden; }
                .course-name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: bold;}
                .teacher-name { display: block; font-size: 12px; color: #555; }
                .course-status { font-size: 12px; color: #666; margin: 0 8px; min-width: 30px; text-align: right; flex-shrink: 0; }
                .delete-btn { width: 18px; height: 18px; border: none; background-color: #dc3545; color: white; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; padding: 0; flex-shrink: 0; position: relative;}
                .delete-btn::after { content: '×'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
                .retry-settings-group input[type="checkbox"] { margin-left: auto; }
            </style>
            <div id="grabber-panel-handle" style="cursor: grab; user-select: none;">
                 <h3 style="margin-top: 0; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px; text-align:center;">🚀 选课助手 v8.1 (专业版)</h3>
            </div>
            <button id="auto-detect-btn">一键识别选课时间</button>
            <div class="time-input-group">
                <label>时</label><input type="number" id="grab-time-h" min="0" max="23" value="08">
                <label>分</label><input type="number" id="grab-time-m" min="0" max="59" value="00">
                <label>秒</label><input type="number" id="grab-time-s" min="0" max="59" value="00">
                <label>毫秒</label><input type="number" id="grab-time-ms" min="0" max="999" step="10" value="500">
            </div>
             <div class="retry-settings-group">
                <label for="retry-enabled-checkbox">自动重试</label> <input type="checkbox" id="retry-enabled-checkbox" checked>
                <label>次数</label><input type="number" id="retry-attempts-input" value="5" min="1" style="width:40px;">
                <label>间隔(ms)</label><input type="number" id="retry-delay-input" value="50" min="10" step="10" style="width:50px;">
            </div>
            <button id="arm-grabber-btn" style="width: 100%; padding: 8px; border: none; background-color: #28a745; color: white; border-radius: 4px; cursor: pointer; font-size: 16px;">启动定时抢课</button>
            <div id="overall-status" style="margin-top: 10px; padding: 5px; background-color: #f0f0f0; border-radius: 4px; text-align: center; font-size: 14px;"></div>
            <div id="captured-list-container"></div>
        `;
        document.body.appendChild(panel);
        listContainer = document.getElementById('captured-list-container');
        overallStatusDiv = document.getElementById('overall-status');
        document.getElementById('auto-detect-btn').addEventListener('click', autoDetectAndFillTime);
        document.getElementById('arm-grabber-btn').addEventListener('click', armGrabber);
        makePanelDraggable(panel, document.getElementById('grabber-panel-handle'));
        makePanelResizable(panel);
        renderCapturedList();
    }

    function armGrabber() {
        if (Object.keys(capturedRequests).length === 0) {
            updateOverallStatus('❌ 错误：尚未捕获任何课程！', true);
            return;
        }
        const hours = parseInt(document.getElementById('grab-time-h').value);
        const minutes = parseInt(document.getElementById('grab-time-m').value);
        const seconds = parseInt(document.getElementById('grab-time-s').value);
        const ms = parseInt(document.getElementById('grab-time-ms').value);
        if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(ms)) {
             updateOverallStatus('❌ 错误：时间输入无效！', true);
            return;
        }
        const now = new Date();
        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds, ms);
        const delay = targetTime.getTime() - now.getTime();
        if (delay < 0) {
            updateOverallStatus('❌ 错误：设定时间已过！', true);
            return;
        }
        const targetTimeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(3, '0')}`;
        updateOverallStatus(`🚀 准备就绪！将在 ${delay / 1000} 秒后发送所有请求。`);
        setTimeout(sendAllCapturedRequests, delay);
    }

    // --- 脚本主执行流程 ---
    function main() {
        createControlPanel();
        const observer = new MutationObserver((mutations) => {
            let nodeAdded = false;
            for (let mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    nodeAdded = true;
                    break;
                }
            }
            if (nodeAdded) {
                unlockAllCourseButtons();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(unlockAllCourseButtons, 500);
    }

    interceptNetworkRequests();
    window.addEventListener('DOMContentLoaded', main);

})();
