import './Upload.css';
import Config from '../../Config';
import ClearButton from './Upload/ClearButton';
import UploadButton from './Upload/UploadButton';
import React, { useState } from 'react';
import axios from 'axios';
import Authentication from '../../Authentication';
import Util from './Util';

const serverURL = Config.SERVER_URL;
const maxFileSize = Config.MAX_ALLOTTED_FILE_SIZE;

function DropZone(props) {
    const displayFiles = props.displayFiles;
    const files = props.files;

    if(displayFiles) {
        return (
            <ul className="FileList"> {
                Object.keys(files).map(file => 
                <li className="File" key={files[file].name}>
                    <div className="FileNameWrapper">
                        <span className="FileName">{files[file].name}</span>
                    </div>
                    <div className="FileSizeWrapper">
                        <span className="FileSize">{Util.formatBytes(files[file].size)}</span>    
                    </div>
                </li>)
            }
            </ul>
        );

    }else {
        return <span className="Instructions">Click or Drag Files here</span>;
    }
}

function Upload() {
    const [files, setFiles] = useState([]);
    const [displayFiles, setDisplayFiles] = useState(false);
    const [contolCenterButtonsActive, setContolCenterButtonsActive] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    function dragOverHandler(event) {
        event.preventDefault();
    }

    function onDrop(event) {
        event.preventDefault();
        if(event.dataTransfer.files) {
            setFiles(event.dataTransfer.files);
            setDisplayFiles(true);
            setContolCenterButtonsActive(true);
        }
    }

    function dropZoneClickHandler() {
        if(!displayFiles) {
            document.getElementById("FileInput").click();
        }
    }

    function fileBrowserInputChange() {
        let fileBrowserFiles = document.getElementById("FileInput").files;

        if(fileBrowserFiles.length > 0) {
            setFiles(fileBrowserFiles);
            setDisplayFiles(true);
            setContolCenterButtonsActive(true);
        }
    }

    function clearUploadPanel() {
        document.getElementById("FileInput").value = null;
        setFiles([]);
        setDisplayFiles(false);
        setContolCenterButtonsActive(false);
        setUploadProgress(0);
    }

    async function uploadButtonClick() {
        if(files.length > 0) {
            let totalFileSize = 0;
            const formData = new FormData();
            Object.keys(files).forEach(file => {
                totalFileSize += files[file].size;
                formData.append(files[file].name, files[file]);
            });
            if(totalFileSize <= maxFileSize) {
                setContolCenterButtonsActive(false);
                let url = serverURL + "/api/files/upload";
                let authorizationToken = "Bearer " + localStorage.getItem('token');
                let responseCode;

                await axios({
                    method: "POST",
                    url: url,
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data', 'authorization': authorizationToken },
                    onUploadProgress: progressEvent => {
                        let progress = Math.round(progressEvent.loaded * 100) / progressEvent.total;
                        setUploadProgress(progress.toFixed(1));
                    }

                }).then(response => responseCode = response.status).catch(error => responseCode = error.response.status);

                switch(responseCode) {
                    case 200:
                        alert("Upload Successful!");
                        clearUploadPanel();
                        break;

                    case 409:
                        alert("Upload Failed -- One or more files already exists!");
                        setContolCenterButtonsActive(true);
                        break;

                    case 500:
                        alert("Upload Failed -- Internal Server Error");
                        setContolCenterButtonsActive(true);
                        break;

                    case 413:
                        alert("Upload Failed -- Max file size exceeded!");
                        setContolCenterButtonsActive(true);
                        break;

                    case 401:
                        let currentToken = localStorage.getItem('token');
                        let statusCode;
                        try {
                            const response = await Authentication.validateToken(currentToken);
                            statusCode = response.status;

                        }catch (e) {
                            statusCode = e.response.status;
                        }
                        if(statusCode === 401) {
                            localStorage.removeItem('token');
                            window.location.reload();
                            alert("You must be logged in!");
                        }
                        break;

                    default:
                        break;
                }
            }else {
                alert("Allotted file size too large!");
            }
        }else {
            alert("No files selected!");
        }
    }

    return (
        <div className="Upload">
            <div className="UploadPanel">
                <div className="FileDropZone" onDrop={onDrop} onDragOver={dragOverHandler} onClick={dropZoneClickHandler}>
                    <DropZone displayFiles={displayFiles} files={files} />
                    <input type="file" id="FileInput" onInput={fileBrowserInputChange} multiple />
                </div>
                <div className="ControlCenter">
                    <ClearButton iconName="close-outline" active={contolCenterButtonsActive} onClick={clearUploadPanel} />
                    <h1 id="Progress">{uploadProgress + "%"}</h1>
                    <UploadButton iconName="checkmark-outline" active={contolCenterButtonsActive} onClick={uploadButtonClick} />
                </div>
            </div>
        </div>
    );
}

export default Upload;