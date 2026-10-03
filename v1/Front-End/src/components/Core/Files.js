import './Files.css';
import Config from '../../Config';
import { useEffect, useState } from 'react';
import axios from 'axios';
import UserFile from './Files/UserFile';
import SortButton from './Files/SortButton';
import RefreshButton from './Files/RefreshButton';
import SearchBar from './Files/SearchBar';
import Util from './Util';
import Authentication from '../../Authentication';

const serverURL = Config.SERVER_URL;

function toggleSortMenu() {
    let element = document.getElementById("DropdownMenu");
    let style = window.getComputedStyle(element).getPropertyValue("display");
    if(style === "none") {
        element.style.display = "block";

    }else if(style === "block") {
        element.style.display = "none";
    }
}

async function downloadFile(fileName, fileUUID) {
    let url = serverURL + "/f/d/" + fileUUID;
    await axios({
        url: url,
        method: "GET",
        responseType: "blob",

    }).then(response => {
        const objUrl = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement("a");
        link.href = objUrl;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(objUrl);
    });
}

function copyToClipboard(str) {
    const el = document.createElement('textarea');
    el.value = str;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}

async function deleteFile(fileUUID, resp, err) {
    let url = serverURL + "/api/files/delete/" + fileUUID;
    let authorizationToken = "Bearer " + localStorage.getItem('token');
    await axios({
        method: "delete",
        url: url,
        headers: { 'Content-Type': 'application/json', 'authorization': authorizationToken}
    }).then(response => resp).catch(error => err);
}

function Files() {
    const [usersFiles, setUsersFiles] = useState([]);
    let authorizationToken = "Bearer " + localStorage.getItem('token');
    
    async function sortButtonSubMenuClick(sortOrder) {
        Util.setSortOrder(sortOrder);
        await getUsersFiles();
        toggleSortMenu();
        
    }

    async function getUsersFiles() {
        let currentToken = localStorage.getItem('token');
        let statusCode;
        try {
            const response = await Authentication.validateToken(currentToken);
            statusCode = response.status;

        }catch (e) {
            statusCode = e.response.status;
        }
        if(statusCode === 200) {
            let url = serverURL + "/f";
            let sortOrder = localStorage.getItem('sortOrder');
            await axios({
                method: "POST",
                url: url,
                headers: { 'Content-Type': 'application/json', 'authorization': authorizationToken},
                data: {'sortOrder': sortOrder}
    
            }).then(response => {
                setUsersFiles(response.data);
                sessionStorage.setItem('files', JSON.stringify(response.data));

            }).catch(error => {
                if(error.response.status === 404) {
                    setUsersFiles([]);
                    sessionStorage.setItem('files', JSON.parse("[]"));
                    alert("No files found");
                }
            });
        
        }else {
            localStorage.removeItem('token');
            window.location.reload();
        }
    }

    async function searchUsersFiles() {
        let currentToken = localStorage.getItem('token');
        let statusCode;
        try {
            const response = await Authentication.validateToken(currentToken);
            statusCode = response.status;

        }catch (e) {
            statusCode = e.response.status;
        }
        if(statusCode === 200) {
            let searchInput = document.getElementById("SearchInput");
            if(searchInput && searchInput.value) {
                let url = serverURL + "/f/s/" + searchInput.value;
                await axios({
                    method: "GET",
                    url: url,
                    headers: { 'Content-Type': 'application/json', 'authorization': authorizationToken}
        
                }).then(response => {
                    if(typeof(response.data) === "object") {
                        setUsersFiles(response.data);
                    }
    
                }).catch(error => {
                    if(error.response.status === 404 && localStorage.getItem('files') && localStorage.getItem('files').length > 2) {
                        setUsersFiles(JSON.parse(sessionStorage.getItem('files')));
                        
                    }else {
                        setUsersFiles([]);
                    }
                });
            }else {
                setUsersFiles(JSON.parse(sessionStorage.getItem('files')));
            }
        
        }else {
            localStorage.removeItem('token');
            window.location.reload();
        }
    }

    useEffect(() => {
        if(sessionStorage.getItem('files')) {
            setUsersFiles(JSON.parse(sessionStorage.getItem('files')));

        }else {
            getUsersFiles();
        }

    }, []);

    return (
        <div className="Files">
            <div className="ControlsBar">
                <div className="ControlButtons">
                    <SortButton
                        onClick={toggleSortMenu} 
                        dropDownOne={() => {sortButtonSubMenuClick("alphabetical");}} 
                        dropDownTwo={() => {sortButtonSubMenuClick("chronological");}}
                        dropDownThree={() => {sortButtonSubMenuClick("size");}}
                    />
                    <RefreshButton onClick={getUsersFiles} />
                </div>
                <SearchBar onChange={searchUsersFiles} />
            </div>
            <div className="FileListWrapper">
                <ul className="UsersFileList"> {
                Object.keys(usersFiles).map(file =>
                    <UserFile 
                        key={usersFiles[file].uniqueID}
                        fileName={usersFiles[file].fileName}
                        fileSize={Util.formatBytes(usersFiles[file].fileSize)}
                        fileDate={usersFiles[file].timeOfUploadDate}
                        downloadButtonClick={() => {
                            downloadFile(usersFiles[file].fileName, usersFiles[file].uniqueID);
                        }}
                        viewButtonClick={() => {
                            window.open(serverURL + "/f/v/" + usersFiles[file].uniqueID);
                        }}
                        copyDownloadButtonClick={() => {
                            copyToClipboard(serverURL + "/f/d/" + usersFiles[file].uniqueID);
                            alert("Copied Download Link!");
                        }}
                        copyViewButtonClick={() => {
                            copyToClipboard(serverURL + "/f/v/" + usersFiles[file].uniqueID);
                            alert("Copied View Link!");
                        }}
                        deleteButtonClick={() => {
                            deleteFile(usersFiles[file].uniqueID);
                            getUsersFiles();
                        }}
                    />
                )}
                </ul>
            </div>
        </div>
    );
}

export default Files;
