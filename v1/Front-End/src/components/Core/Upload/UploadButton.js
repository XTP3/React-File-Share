import './UploadButton.css';

function ActiveUploadButton(props) {
    return (
        <div className="ActiveUploadButton" onClick={props.onClick}>
            <ion-icon name={props.iconName}></ion-icon>
        </div>
    );
}

function InactiveUploadButton(props) {
    return (
        <div className="InactiveUploadButton">
            <ion-icon name={props.iconName}></ion-icon>
        </div>
    );
}

function UploadButton(props) {
    let active = props.active;
    let iconName = props.iconName;
    let onClick = props.onClick;

    if(active) {
        return <ActiveUploadButton iconName={iconName} onClick={onClick} />;

    }else {
        return <InactiveUploadButton iconName={iconName} />;
    }
}

export default UploadButton;