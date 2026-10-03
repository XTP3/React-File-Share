import './UserFile.css';

function UserFile(props) {
    let fileName = props.fileName;
    let fileSize = props.fileSize;
    let fileDate = props.fileDate;

    return (
    <li className="UserFile">
        <div className="UserFileName">
            <div className="DisplayIconWrapper">
                <ion-icon name="bookmark-outline"></ion-icon>
            </div>
            <span className="UFileName">{fileName}</span>
        </div>
        <div className="UserFileSize">
            <div className="DisplayIconWrapper">
                <ion-icon name="server-outline"></ion-icon>
            </div>
            <span className="UFileSize">{fileSize}</span>
        </div>
        <div className="UserFileUploadDate">
            <div className="DisplayIconWrapper">
                <ion-icon name="calendar-outline"></ion-icon>
            </div>
            <span className="UUploadDate">{fileDate}</span>
        </div>
        <div className="UserFileActions">
            <div className="DownloadButton" onClick={props.downloadButtonClick}>
                <ion-icon name="download-outline"></ion-icon>
                <span className="ButtonTitle">Download</span>
            </div>
            <div className="ViewButton" onClick={props.viewButtonClick}>
                <ion-icon name="open-outline"></ion-icon>
                <span className="ButtonTitle">View</span>
            </div>
            <div className="CopyDownloadLinkButton" onClick={props.copyDownloadButtonClick}>
                <ion-icon name="code-download-outline"></ion-icon>
                <span className="ButtonTitle">Download Link</span>
            </div>
            <div className="CopyViewLinkButton" onClick={props.copyViewButtonClick}>
                <ion-icon name="clipboard-outline"></ion-icon>
                <span className="ButtonTitle">View Link</span>
            </div>
            <div className="DeleteButton" onClick={props.deleteButtonClick}>
                <ion-icon name="close-outline"></ion-icon>
                <span className="ButtonTitle">Delete</span>
            </div>
        </div>
    </li>   
    );
}

export default UserFile;