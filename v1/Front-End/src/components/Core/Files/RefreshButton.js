import './RefreshButton.css';

function RefreshButton(props) {
    return (
        <div className="RefreshButton" onClick={props.onClick}>
            <ion-icon name="refresh-outline"></ion-icon>
            <span className="Title" id="RefreshTitle">Refresh</span>
        </div>
    );
}

export default RefreshButton;